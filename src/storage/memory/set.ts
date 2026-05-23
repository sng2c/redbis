// @ts-nocheck
import { assertType } from '../type-check';
import type { InMemoryStorage } from './core';

export const setMethods = {
  _ensureSetTypeOrThrow(key: string): void {
    assertType(this.store.get(key)?.type, 'set');
  },

  _cleanupSetIfEmpty(key: string): void {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'set') return;
    const set = this.setStore.get(key);
    if (!set || set.size === 0) {
      this.setStore.delete(key);
      this.store.delete(key);
    }
  },

  async sadd(key: string, members: string[]): Promise<number> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'set', expiresAt: null });
    }
    let set = this.setStore.get(key);
    if (!set) {
      set = new Set<string>();
      this.setStore.set(key, set);
    }
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        added++;
      }
      set.add(member);
    }
    return added;
  },

  async srem(key: string, members: string[]): Promise<number> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed++;
    }
    this._cleanupSetIfEmpty(key);
    return removed;
  },

  async smembers(key: string): Promise<string[]> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set) return [];
    return Array.from(set);
  },

  async scard(key: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    return set ? set.size : 0;
  },

  async sismember(key: string, member: string): Promise<boolean> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    return set ? set.has(member) : false;
  },

  async smismember(key: string, members: string[]): Promise<boolean[]> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set) return members.map(() => false);
    return members.map((m) => set.has(m));
  },

  async srandmember(key: string, count?: number): Promise<string[]> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set || set.size === 0) return [];
    const arr = Array.from(set);
    const effectiveCount = count ?? 1;
    if (effectiveCount >= 0) {
      if (effectiveCount >= arr.length) {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      }
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, effectiveCount);
    } else {
      const absCount = Math.abs(effectiveCount);
      const result: string[] = [];
      for (let i = 0; i < absCount; i++) {
        result.push(arr[Math.floor(Math.random() * arr.length)]);
      }
      return result;
    }
  },

  async spop(key: string, count?: number): Promise<string[]> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set || set.size === 0) return [];
    const actualCount = count ?? 1;
    const arr = Array.from(set);
    const popped: string[] = [];
    if (actualCount >= arr.length) {
      popped.push(...arr);
      set.clear();
    } else {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (let i = 0; i < actualCount; i++) {
        const member = shuffled[i];
        popped.push(member);
        set.delete(member);
      }
    }
    this._cleanupSetIfEmpty(key);
    return popped;
  },

  async smove(source: string, destination: string, member: string): Promise<boolean> {
    this.evictIfExpired(source);
    this.evictIfExpired(destination);
    this._ensureSetTypeOrThrow(source);
    this._ensureSetTypeOrThrow(destination);
    const srcSet = this.setStore.get(source);
    if (!srcSet || !srcSet.has(member)) return false;
    srcSet.delete(member);
    if (source === destination) {
      // Same key: re-add to same set (no visible change)
      srcSet.add(member);
      this._cleanupSetIfEmpty(source);
      return true;
    }
    if (!this.store.has(destination)) {
      this.store.set(destination, { value: '', type: 'set', expiresAt: null });
    }
    let destSet = this.setStore.get(destination);
    if (!destSet) {
      destSet = new Set<string>();
      this.setStore.set(destination, destSet);
    }
    destSet.add(member);
    this._cleanupSetIfEmpty(source);
    return true;
  },

  async sdiff(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const firstSet = this.setStore.get(keys[0]);
    if (!firstSet) return [];
    const firstMembers = new Set(firstSet);
    for (let i = 1; i < keys.length; i++) {
      const otherSet = this.setStore.get(keys[i]);
      if (otherSet) {
        for (const member of otherSet) {
          firstMembers.delete(member);
        }
      }
    }
    return Array.from(firstMembers);
  },

  async sinter(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const firstSet = this.setStore.get(keys[0]);
    if (!firstSet) return [];
    let result = new Set(firstSet);
    for (let i = 1; i < keys.length; i++) {
      const otherSet = this.setStore.get(keys[i]);
      if (!otherSet) return [];
      const next = new Set<string>();
      for (const member of result) {
        if (otherSet.has(member)) next.add(member);
      }
      result = next;
      if (result.size === 0) return [];
    }
    return Array.from(result);
  },

  async sunion(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const result = new Set<string>();
    for (const key of keys) {
      const set = this.setStore.get(key);
      if (set) {
        for (const member of set) {
          result.add(member);
        }
      }
    }
    return Array.from(result);
  },

  async sdiffstore(destination: string, keys: string[]): Promise<number> {
    this.evictIfExpired(destination);
    this._ensureSetTypeOrThrow(destination);
    for (const key of keys) this.evictIfExpired(key);
    const diff = await this.sdiff(keys);
    if (diff.length === 0) {
      if (this.store.has(destination) && this.store.get(destination)!.type === 'set') {
        this.setStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this.store.set(destination, { value: '', type: 'set', expiresAt: null });
    this.setStore.set(destination, new Set(diff));
    return diff.length;
  },

  async sinterstore(destination: string, keys: string[]): Promise<number> {
    this.evictIfExpired(destination);
    this._ensureSetTypeOrThrow(destination);
    for (const key of keys) this.evictIfExpired(key);
    const inter = await this.sinter(keys);
    if (inter.length === 0) {
      if (this.store.has(destination) && this.store.get(destination)!.type === 'set') {
        this.setStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this.store.set(destination, { value: '', type: 'set', expiresAt: null });
    this.setStore.set(destination, new Set(inter));
    return inter.length;
  },

  async sunionstore(destination: string, keys: string[]): Promise<number> {
    this.evictIfExpired(destination);
    this._ensureSetTypeOrThrow(destination);
    for (const key of keys) this.evictIfExpired(key);
    const union = await this.sunion(keys);
    if (union.length === 0) {
      if (this.store.has(destination) && this.store.get(destination)!.type === 'set') {
        this.setStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this.store.set(destination, { value: '', type: 'set', expiresAt: null });
    this.setStore.set(destination, new Set(union));
    return union.length;
  },

  async sintercard(keys: string[], limit?: number): Promise<number> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    const inter = await this.sinter(keys);
    if (limit !== undefined) {
      return Math.min(inter.length, limit);
    }
    return inter.length;
  },

  async sscan(
    key: string,
    cursor: number,
    pattern?: string,
    count?: number
  ): Promise<[number, string[]]> {
    this.evictIfExpired(key);
    this._ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set) return [0, []];
    const allMembers = Array.from(set).sort();
    const effectiveCount = count ?? 10;
    let idx = cursor;
    let scanned = 0;
    const regex = pattern ? this._hashGlobToRegex(pattern) : null;
    const matchedMembers: string[] = [];
    while (idx < allMembers.length) {
      const member = allMembers[idx];
      idx++;
      scanned++;
      if (!regex || regex.test(member)) {
        matchedMembers.push(member);
        if (matchedMembers.length >= effectiveCount) break;
      }
    }
    const nextCursor = idx >= allMembers.length ? 0 : idx;
    return [nextCursor, matchedMembers];
  },
};
