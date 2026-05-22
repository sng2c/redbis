// @ts-nocheck
import { assertType } from '../type-check';
import type { InMemoryStorage } from './core';

export const listMethods = {
_ensureListTypeOrThrow(key: string): void {
    assertType(this.store.get(key)?.type, 'list');
  },

_ensureListKeyExists(key: string): void {
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'list', expiresAt: null });
    }
    if (!this.listStore.has(key)) {
      this.listStore.set(key, []);
    }
  },

_cleanupListIfEmpty(key: string): void {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'list') return;
    const list = this.listStore.get(key);
    if (!list || list.length === 0) {
      this.listStore.delete(key);
      this.store.delete(key);
    }
  },

async lpush(key: string, elements: string[]): Promise<number> {
    this.evictIfExpired(key);
    this._ensureListTypeOrThrow(key);
    this._ensureListKeyExists(key);
    const list = this.listStore.get(key)!;
    for (const el of elements) {
      list.unshift(el);
    }
    return list.length;
  },

async rpush(key: string, elements: string[]): Promise<number> {
    this.evictIfExpired(key);
    this._ensureListTypeOrThrow(key);
    this._ensureListKeyExists(key);
    const list = this.listStore.get(key)!;
    list.push(...elements);
    return list.length;
  },

async lpop(key: string, count?: number): Promise<string | string[] | null> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return count !== undefined ? null : null;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list || list.length === 0) {
      this._cleanupListIfEmpty(key);
      return count !== undefined ? null : null;
    }
    if (count === undefined || count === 1) {
      const val = list.shift()!;
      this._cleanupListIfEmpty(key);
      return val;
    }
    const result: string[] = [];
    for (let i = 0; i < count && list.length > 0; i++) {
      result.push(list.shift()!);
    }
    this._cleanupListIfEmpty(key);
    return result;
  },

async rpop(key: string, count?: number): Promise<string | string[] | null> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return null;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list || list.length === 0) {
      this._cleanupListIfEmpty(key);
      return null;
    }
    if (count === undefined || count === 1) {
      const val = list.pop()!;
      this._cleanupListIfEmpty(key);
      return val;
    }
    const result: string[] = [];
    for (let i = 0; i < count && list.length > 0; i++) {
      result.push(list.pop()!);
    }
    this._cleanupListIfEmpty(key);
    return result;
  },

async llen(key: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    return list ? list.length : 0;
  },

async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return [];
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return [];
    const len = list.length;
    let s = start;
    let e = stop;
    if (s < 0) s = Math.max(len + s, 0);
    if (e < 0) e = len + e;
    if (s > e || s >= len) return [];
    if (e >= len) e = len - 1;
    return list.slice(s, e + 1);
  },

async lindex(key: string, index: number): Promise<string | null> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return null;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return null;
    let idx = index;
    if (idx < 0) idx = list.length + idx;
    if (idx < 0 || idx >= list.length) return null;
    return list[idx];
  },

async lset(key: string, index: number, element: string): Promise<void> {
    this.evictIfExpired(key);
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) throw new Error('ERR no such key');
    let idx = index;
    if (idx < 0) idx = list.length + idx;
    if (idx < 0 || idx >= list.length) throw new Error('ERR index out of range');
    list[idx] = element;
  },

async lrem(key: string, count: number, element: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return 0;
    let removed = 0;
    if (count > 0) {
      for (let i = list.length - 1; i >= 0; i--) {
        // Iterate forward, remove first count matches
      }
      const newList: string[] = [];
      let remaining = count;
      for (const item of list) {
        if (remaining > 0 && item === element) {
          remaining--;
          removed++;
        } else {
          newList.push(item);
        }
      }
      list.length = 0;
      list.push(...newList);
    } else if (count < 0) {
      const newList: string[] = [];
      let remaining = Math.abs(count);
      const reversed = [...list].reverse();
      const kept: string[] = [];
      for (const item of reversed) {
        if (remaining > 0 && item === element) {
          remaining--;
          removed++;
        } else {
          kept.push(item);
        }
      }
      kept.reverse();
      list.length = 0;
      list.push(...kept);
    } else {
      removed = list.filter(item => item === element).length;
      const newList = list.filter(item => item !== element);
      list.length = 0;
      list.push(...newList);
    }
    this._cleanupListIfEmpty(key);
    return removed;
  },

async ltrim(key: string, start: number, stop: number): Promise<void> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return;
    const len = list.length;
    let s = start;
    let e = stop;
    if (s < 0) s = Math.max(len + s, 0);
    if (e < 0) e = len + e;
    if (s > e || s >= len) {
      list.length = 0;
      this._cleanupListIfEmpty(key);
      return;
    }
    if (e >= len) e = len - 1;
    const trimmed = list.slice(s, e + 1);
    list.length = 0;
    list.push(...trimmed);
    this._cleanupListIfEmpty(key);
  },

async lpos(key: string, element: string, options?: { rank?: number; maxlen?: number }): Promise<number | null> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return null;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return null;
    const rank = options?.rank ?? 1;
    const maxlen = options?.maxlen ?? list.length;
    const effectiveLen = Math.min(maxlen, list.length);
    let matchCount = 0;
    for (let i = 0; i < effectiveLen; i++) {
      if (list[i] === element) {
        matchCount++;
        if (matchCount === rank) {
          return i;
        }
      }
    }
    return null;
  },

async rpoplpush(source: string, destination: string): Promise<string | null> {
    this.evictIfExpired(source);
    this.evictIfExpired(destination);
    this._ensureListTypeOrThrow(source);
    this._ensureListTypeOrThrow(destination);
    const srcList = this.listStore.get(source);
    if (!srcList || srcList.length === 0) return null;
    const val = srcList.pop()!;
    this._ensureListKeyExists(destination);
    const destList = this.listStore.get(destination)!;
    destList.unshift(val);
    this._cleanupListIfEmpty(source);
    return val;
  },

async lpushx(key: string, element: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return 0;
    list.unshift(element);
    return list.length;
  },

async rpushx(key: string, element: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return 0;
    list.push(element);
    return list.length;
  },

async linsert(key: string, position: 'BEFORE' | 'AFTER', pivot: string, element: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this._ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return 0;
    const pivotIndex = list.indexOf(pivot);
    if (pivotIndex === -1) return -1;
    const insertIndex = position === 'BEFORE' ? pivotIndex : pivotIndex + 1;
    list.splice(insertIndex, 0, element);
    return list.length;
  },

async lmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT'): Promise<string | null> {
    this.evictIfExpired(source);
    this.evictIfExpired(destination);
    this._ensureListTypeOrThrow(source);
    this._ensureListTypeOrThrow(destination);
    const srcList = this.listStore.get(source);
    if (!srcList || srcList.length === 0) return null;
    const val = srcDir === 'LEFT' ? srcList.shift()! : srcList.pop()!;
    this._ensureListKeyExists(destination);
    const destList = this.listStore.get(destination)!;
    if (destDir === 'LEFT') {
      destList.unshift(val);
    } else {
      destList.push(val);
    }
    this._cleanupListIfEmpty(source);
    return val;
  },

async blpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null> {
    for (const key of keys) {
      this.evictIfExpired(key);
      this._ensureListTypeOrThrow(key);
      if (this.store.has(key)) {
        const list = this.listStore.get(key);
        if (list && list.length > 0) {
          const val = list.shift()!;
          this._cleanupListIfEmpty(key);
          return { key, element: val };
        }
      }
    }
    return null;
  },

async brpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null> {
    for (const key of keys) {
      this.evictIfExpired(key);
      this._ensureListTypeOrThrow(key);
      if (this.store.has(key)) {
        const list = this.listStore.get(key);
        if (list && list.length > 0) {
          const val = list.pop()!;
          this._cleanupListIfEmpty(key);
          return { key, element: val };
        }
      }
    }
    return null;
  },

async brpoplpush(source: string, destination: string, timeout: number): Promise<string | null> {
    return this.rpoplpush(source, destination);
  },

async blmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT', timeout: number): Promise<string | null> {
    return this.lmove(source, destination, srcDir, destDir);
  },

async lmpop(numkeys: number, keys: string[], dir: 'LEFT' | 'RIGHT', count?: number): Promise<{ key: string; elements: string[] } | null> {
    const effectiveCount = count ?? 1;
    for (const key of keys) {
      this.evictIfExpired(key);
      this._ensureListTypeOrThrow(key);
      if (this.store.has(key)) {
        const list = this.listStore.get(key);
        if (list && list.length > 0) {
          const elements: string[] = [];
          for (let i = 0; i < effectiveCount && list.length > 0; i++) {
            if (dir === 'LEFT') {
              elements.push(list.shift()!);
            } else {
              elements.push(list.pop()!);
            }
          }
          this._cleanupListIfEmpty(key);
          return { key, elements };
        }
      }
    }
    return null;
  },

};
