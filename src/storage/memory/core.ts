import { globToRegex } from '../../utils/glob';
// InMemoryStorage core — data structures, shared helpers, and core key-value methods.
// Data-type methods are added via mixins (see index.ts).

import type { StoreEntry, StreamData, InternalStreamGroup, InternalStreamConsumer } from './types';

export class InMemoryStorage {
  // Public data stores (accessible by mixin methods via this)
  store: Map<string, StoreEntry> = new Map();
  hashStore: Map<string, Map<string, { value: string; expiresAt: number | null }>> = new Map();
  listStore: Map<string, string[]> = new Map();
  setStore: Map<string, Set<string>> = new Map();
  zsetStore: Map<string, Map<string, number>> = new Map();
  geoStore: Map<string, Map<string, { longitude: number; latitude: number }>> = new Map();
  streamStore: Map<string, StreamData> = new Map();
  startTime = Date.now();

  isExpired(entry: StoreEntry): boolean {
    return entry.expiresAt !== null && Date.now() >= entry.expiresAt;
  }

  evictIfExpired(key: string): void {
    const entry = this.store.get(key);
    if (entry && this.isExpired(entry)) {
      this.store.delete(key);
      this.hashStore.delete(key);
      this.listStore.delete(key);
      this.setStore.delete(key);
      this.zsetStore.delete(key);
      this.geoStore.delete(key);
      this.streamStore.delete(key);
    }
  }

  evictAllExpired(): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.store) {
      if (this.isExpired(entry)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.store.delete(key);
      this.hashStore.delete(key);
      this.listStore.delete(key);
      this.setStore.delete(key);
      this.zsetStore.delete(key);
      this.geoStore.delete(key);
      this.streamStore.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    return entry?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.evictIfExpired(key);
    this.store.set(key, { value, type: 'string', expiresAt: null });
  }

  async delete(key: string): Promise<boolean> {
    this.evictIfExpired(key);
    const result = this.store.delete(key);
    this.hashStore.delete(key);
    this.listStore.delete(key);
    this.setStore.delete(key);
    this.zsetStore.delete(key);
    this.geoStore.delete(key);
    this.streamStore.delete(key);
    return result;
  }

  async keys(pattern: string): Promise<string[]> {
    this.evictAllExpired();
    const regex = globToRegex(pattern);
    const result: string[] = [];
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        result.push(key);
      }
    }
    return result.sort();
  }

  async flush(): Promise<void> {
    this.store.clear();
    this.hashStore.clear();
    this.listStore.clear();
    this.setStore.clear();
    this.zsetStore.clear();
    this.geoStore.clear();
    this.streamStore.clear();
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    const result: (string | null)[] = [];
    for (const key of keys) {
      this.evictIfExpired(key);
      const entry = this.store.get(key);
      result.push(entry?.value ?? null);
    }
    return result;
  }

  async mset(pairs: Array<{ key: string; value: string }>): Promise<void> {
    for (const { key } of pairs) {
      this.evictIfExpired(key);
    }
    for (const { key, value } of pairs) {
      this.store.set(key, { value, type: 'string', expiresAt: null });
    }
  }

  async msetnx(pairs: Array<{ key: string; value: string }>): Promise<boolean> {
    // Evict all relevant keys first
    for (const { key } of pairs) {
      this.evictIfExpired(key);
    }
    // Check if any key already exists
    for (const { key } of pairs) {
      if (this.store.has(key)) {
        return false;
      }
    }
    // None exist, set all
    for (const { key, value } of pairs) {
      this.store.set(key, { value, type: 'string', expiresAt: null });
    }
    return true;
  }

  async append(key: string, value: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) {
      this.store.set(key, { value, type: 'string', expiresAt: null });
      return value.length;
    }
    entry.value += value;
    return entry.value.length;
  }

  async strlen(key: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    return entry?.value.length ?? 0;
  }

  async getrange(key: string, start: number, end: number): Promise<string> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return '';
    const str = entry.value;
    const len = str.length;
    if (start < 0) start = Math.max(len + start, 0);
    if (end < 0) end = Math.max(len + end, 0);
    if (start > end || start >= len) return '';
    return str.substring(start, end + 1);
  }

  async setrange(key: string, offset: number, value: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    let current: string;
    let existingExpiresAt = entry?.expiresAt ?? null;
    let existingType = entry?.type ?? 'string';

    if (!entry) {
      current = '';
    } else {
      current = entry.value;
    }

    // Pad with null bytes if offset > current length
    if (offset > current.length) {
      current = current + '\0'.repeat(offset - current.length);
    }

    // Apply the replacement
    const before = current.substring(0, offset);
    const after = current.substring(offset + value.length);
    const newValue = before + value + after;

    this.store.set(key, { value: newValue, type: existingType, expiresAt: existingExpiresAt });
    return newValue.length;
  }

  async incrby(key: string, delta: number): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    let current: number;
    if (!entry) {
      current = 0;
    } else {
      const parsed = parseInt(entry.value, 10);
      if (isNaN(parsed) || !Number.isInteger(parsed)) {
        throw new Error('ERR value is not an integer or out of range');
      }
      current = parsed;
    }
    const result = current + delta;
    this.store.set(key, {
      value: String(result),
      type: 'string',
      expiresAt: entry?.expiresAt ?? null,
    });
    return result;
  }

  async incrbyfloat(key: string, delta: number): Promise<string> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    let current: number;
    if (!entry) {
      current = 0;
    } else {
      const parsed = parseFloat(entry.value);
      if (isNaN(parsed)) {
        throw new Error('ERR value is not a valid float');
      }
      current = parsed;
    }
    const result = current + delta;
    if (isNaN(result)) {
      throw new Error('ERR value is not a valid float');
    }
    // Redis-style: remove trailing zeros, ensure at least one decimal if fractional
    let resultStr: string;
    if (Number.isInteger(result) && !delta.toString().includes('.')) {
      resultStr = String(result);
    } else {
      // Use toFixed with high precision then strip trailing zeros
      resultStr = parseFloat(result.toPrecision(15)).toString();
      // Redis always shows at least one decimal if the result is not integer
      // But we need to match Redis behavior: e.g., "1.5" not "1.5000000000000000"
    }
    this.store.set(key, { value: resultStr, type: 'string', expiresAt: entry?.expiresAt ?? null });
    return resultStr;
  }

  async setnx(key: string, value: string): Promise<boolean> {
    this.evictIfExpired(key);
    if (this.store.has(key)) {
      return false;
    }
    this.store.set(key, { value, type: 'string', expiresAt: null });
    return true;
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    if (seconds <= 0) {
      throw new Error("ERR invalid expire time in 'SETEX' command");
    }
    this.evictIfExpired(key);
    this.store.set(key, { value, type: 'string', expiresAt: Date.now() + seconds * 1000 });
  }

  async psetex(key: string, milliseconds: number, value: string): Promise<void> {
    if (milliseconds <= 0) {
      throw new Error("ERR invalid expire time in 'PSETEX' command");
    }
    this.evictIfExpired(key);
    this.store.set(key, { value, type: 'string', expiresAt: Date.now() + milliseconds });
  }

  async getset(key: string, value: string): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    const oldValue = entry?.value ?? null;
    this.store.set(key, { value, type: 'string', expiresAt: null });
    return oldValue;
  }

  async getdel(key: string): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    const value = entry.value;
    this.store.delete(key);
    return value;
  }

  async getex(
    key: string,
    options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }
  ): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    const value = entry.value;

    if (options) {
      if (options.persist) {
        entry.expiresAt = null;
      } else if (options.px !== undefined) {
        entry.expiresAt = Date.now() + options.px;
      } else if (options.ex !== undefined) {
        entry.expiresAt = Date.now() + options.ex * 1000;
      } else if (options.pxat !== undefined) {
        entry.expiresAt = options.pxat;
      } else if (options.exat !== undefined) {
        entry.expiresAt = options.exat * 1000;
      }
    }

    return value;
  }

  async rename(oldKey: string, newKey: string): Promise<void> {
    this.evictIfExpired(oldKey);
    this.evictIfExpired(newKey);
    const entry = this.store.get(oldKey);
    if (!entry) {
      throw new Error('ERR no such key');
    }
    this.store.delete(oldKey);
    this.store.set(newKey, { ...entry });
    if (this.hashStore.has(oldKey)) {
      this.hashStore.set(newKey, this.hashStore.get(oldKey)!);
      this.hashStore.delete(oldKey);
    }
    if (this.listStore.has(oldKey)) {
      this.listStore.set(newKey, this.listStore.get(oldKey)!);
      this.listStore.delete(oldKey);
    }
    if (this.setStore.has(oldKey)) {
      this.setStore.set(newKey, this.setStore.get(oldKey)!);
      this.setStore.delete(oldKey);
    }
    if (this.zsetStore.has(oldKey)) {
      this.zsetStore.set(newKey, this.zsetStore.get(oldKey)!);
      this.zsetStore.delete(oldKey);
    }
    if (this.geoStore.has(oldKey)) {
      this.geoStore.set(newKey, this.geoStore.get(oldKey)!);
      this.geoStore.delete(oldKey);
    }
    if (this.streamStore.has(oldKey)) {
      this.streamStore.set(newKey, this.streamStore.get(oldKey)!);
      this.streamStore.delete(oldKey);
    }
  }

  async renamenx(oldKey: string, newKey: string): Promise<boolean> {
    this.evictIfExpired(oldKey);
    this.evictIfExpired(newKey);

    const entry = this.store.get(oldKey);
    if (!entry) {
      throw new Error('ERR no such key');
    }

    // Per Redis behavior: if oldKey === newKey, return true
    if (oldKey === newKey) {
      return true;
    }

    if (this.store.has(newKey)) {
      return false;
    }

    this.store.delete(oldKey);
    this.store.set(newKey, { ...entry });
    return true;
  }

  async type(key: string): Promise<string> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    return entry?.type ?? 'none';
  }

  async dbsize(): Promise<number> {
    this.evictAllExpired();
    return this.store.size;
  }

  async copy(source: string, destination: string): Promise<boolean> {
    this.evictIfExpired(source);
    this.evictIfExpired(destination);
    const entry = this.store.get(source);
    if (!entry) return false;
    if (source === destination) return false;
    this.store.set(destination, { ...entry });
    if (entry.type === 'hash') {
      const fields = this.hashStore.get(source);
      if (fields) {
        this.hashStore.set(destination, new Map(fields));
      }
    }
    if (entry.type === 'list') {
      const items = this.listStore.get(source);
      if (items) {
        this.listStore.set(destination, [...items]);
      }
    }
    if (entry.type === 'set') {
      const members = this.setStore.get(source);
      if (members) {
        this.setStore.set(destination, new Set(members));
      }
    }
    if (entry.type === 'zset') {
      const members = this.zsetStore.get(source);
      if (members) {
        this.zsetStore.set(destination, new Map(members));
      }
    }
    if (entry.type === 'zset') {
      const geoCoords = this.geoStore.get(source);
      if (geoCoords) {
        this.geoStore.set(destination, new Map(geoCoords));
      }
    }
    if (entry.type === 'stream') {
      const streamData = this.streamStore.get(source);
      if (streamData) {
        // Deep copy the stream data
        const newGroups = new Map<string, InternalStreamGroup>();
        for (const [gName, group] of streamData.groups) {
          const newConsumers = new Map<string, InternalStreamConsumer>();
          for (const [cName, consumer] of group.consumers) {
            newConsumers.set(cName, { ...consumer });
          }
          newGroups.set(gName, {
            ...group,
            consumers: newConsumers,
            pending: group.pending.map((p) => ({ ...p })),
          });
        }
        this.streamStore.set(destination, {
          entries: streamData.entries.map((e) => ({ ...e, fields: { ...e.fields } })),
          groups: newGroups,
          lastId: streamData.lastId,
          maxDeletedId: streamData.maxDeletedId,
          entriesAdded: streamData.entriesAdded,
          recordedFirstId: streamData.recordedFirstId,
        });
      }
    }
    return true;
  }

  async randomkey(): Promise<string | null> {
    this.evictAllExpired();
    if (this.store.size === 0) return null;
    const keys = Array.from(this.store.keys());
    return keys[Math.floor(Math.random() * keys.length)];
  }

  async unlink(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      this.evictIfExpired(key);
      if (this.store.delete(key)) {
        this.hashStore.delete(key);
        this.listStore.delete(key);
        this.setStore.delete(key);
        this.zsetStore.delete(key);
        this.geoStore.delete(key);
        this.streamStore.delete(key);
        count++;
      }
    }
    return count;
  }

  async touch(keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      this.evictIfExpired(key);
      if (this.store.has(key)) {
        count++;
      }
    }
    return count;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + seconds * 1000;
    return true;
  }

  async expireat(key: string, timestamp: number): Promise<boolean> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = timestamp * 1000;
    return true;
  }

  async pexpire(key: string, milliseconds: number): Promise<boolean> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + milliseconds;
    return true;
  }

  async pexpireat(key: string, millisecondsTimestamp: number): Promise<boolean> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = millisecondsTimestamp;
    return true;
  }

  async ttl(key: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    if (remaining <= 0) {
      // Key has expired (race condition with eviction)
      this.store.delete(key);
      return -2;
    }
    return remaining;
  }

  async pttl(key: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) {
      this.store.delete(key);
      return -2;
    }
    return remaining;
  }

  async persist(key: string): Promise<boolean> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt === null) return false;
    entry.expiresAt = null;
    return true;
  }

  async expiretime(key: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.floor(entry.expiresAt / 1000);
  }

  async pexpiretime(key: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return entry.expiresAt;
  }

  async scan(
    cursor: number,
    pattern?: string,
    count?: number
  ): Promise<{ cursor: number; keys: string[] }> {
    this.evictAllExpired();

    const allKeys = Array.from(this.store.keys()).sort();
    const effectiveCount = count ?? 10;
    const regex = pattern ? globToRegex(pattern) : null;

    const matchedKeys: string[] = [];
    let idx = cursor;

    while (idx < allKeys.length && matchedKeys.length < effectiveCount) {
      const key = allKeys[idx];
      if (!regex || regex.test(key)) {
        matchedKeys.push(key);
      }
      idx++;
    }

    // If we've reached the end, next cursor is 0
    const nextCursor = idx >= allKeys.length ? 0 : idx;

    return { cursor: nextCursor, keys: matchedKeys };
  }
}
