import { IStorage } from './interface';

type StoreEntry = { value: string; type: string; expiresAt: number | null };

function formatMemoryHuman(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb.toFixed(2) + 'K';
  }
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + 'M';
  }
  const gb = bytes / (1024 * 1024 * 1024);
  return gb.toFixed(2) + 'G';
}

export class InMemoryStorage implements IStorage {
  private store: Map<string, StoreEntry> = new Map();
  private hashStore: Map<string, Map<string, { value: string; expiresAt: number | null }>> = new Map();
  private listStore: Map<string, string[]> = new Map();
  private setStore: Map<string, Set<string>> = new Map();
  private zsetStore: Map<string, Map<string, number>> = new Map();
  private startTime = Date.now();

  // === Eviction helpers ===

  private isExpired(entry: StoreEntry): boolean {
    return entry.expiresAt !== null && Date.now() >= entry.expiresAt;
  }

  private evictIfExpired(key: string): void {
    const entry = this.store.get(key);
    if (entry && this.isExpired(entry)) {
      this.store.delete(key);
      this.hashStore.delete(key);
      this.listStore.delete(key);
      this.setStore.delete(key);
      this.zsetStore.delete(key);
    }
  }

  private evictAllExpired(): void {
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
    }
  }

  // === Hash helpers ===

  private ensureHashTypeOrThrow(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private evictExpiredHashFields(key: string): void {
    const fields = this.hashStore.get(key);
    if (!fields) return;
    const now = Date.now();
    for (const [f, e] of fields) {
      if (e.expiresAt !== null && now >= e.expiresAt) {
        fields.delete(f);
      }
    }
  }

  private cleanupHashIfEmpty(key: string): void {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'hash') return;
    const fields = this.hashStore.get(key);
    if (!fields || fields.size === 0) {
      this.hashStore.delete(key);
      this.store.delete(key);
    }
  }

  private hashGlobToRegex(pattern: string): RegExp {
    let regexStr = '^';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === '*') regexStr += '.*';
      else if (ch === '?') regexStr += '.';
      else if ('.+^${}()|[]\\'.includes(ch)) regexStr += '\\' + ch;
      else regexStr += ch;
    }
    regexStr += '$';
    return new RegExp(regexStr);
  }

  // === Glob pattern matching ===

  private globToRegex(pattern: string): RegExp {
    let regexStr = '^';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === '*') {
        regexStr += '.*';
      } else if (ch === '?') {
        regexStr += '.';
      } else if ('.+^${}()|[]\\'.includes(ch)) {
        regexStr += '\\' + ch;
      } else {
        regexStr += ch;
      }
    }
    regexStr += '$';
    return new RegExp(regexStr);
  }

  // === Existing methods ===

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
    return result;
  }

  async keys(pattern: string): Promise<string[]> {
    this.evictAllExpired();
    const regex = this.globToRegex(pattern);
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
  }

  // === Multi-key ===

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

  // === String operations ===

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
    this.store.set(key, { value: String(result), type: 'string', expiresAt: entry?.expiresAt ?? null });
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

  // === Conditional set ===

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
      throw new Error('ERR invalid expire time in \'SETEX\' command');
    }
    this.evictIfExpired(key);
    this.store.set(key, { value, type: 'string', expiresAt: Date.now() + seconds * 1000 });
  }

  async psetex(key: string, milliseconds: number, value: string): Promise<void> {
    if (milliseconds <= 0) {
      throw new Error('ERR invalid expire time in \'PSETEX\' command');
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

  async getex(key: string, options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<string | null> {
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

  // === Key management ===

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

  // === Expiry ===

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

  // === SCAN ===

  async scan(cursor: number, pattern?: string, count?: number): Promise<{ cursor: number; keys: string[] }> {
    this.evictAllExpired();

    const allKeys = Array.from(this.store.keys()).sort();
    const effectiveCount = count ?? 10;
    const regex = pattern ? this.globToRegex(pattern) : null;

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

  // === Hash operations ===

  async hset(key: string, pairs: Array<{ field: string; value: string }>): Promise<number> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.ensureHashTypeOrThrow(key);
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'hash', expiresAt: null });
    }
    if (!this.hashStore.has(key)) {
      this.hashStore.set(key, new Map());
    }
    const fields = this.hashStore.get(key)!;
    let newCount = 0;
    for (const { field, value } of pairs) {
      if (fields.has(field)) {
        const existing = fields.get(field)!;
        fields.set(field, { value, expiresAt: existing.expiresAt });
      } else {
        fields.set(field, { value, expiresAt: null });
        newCount++;
      }
    }
    return newCount;
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return null;
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return null;
    const entry = fields.get(field);
    return entry?.value ?? null;
  }

  async hdel(key: string, fields: string[]): Promise<number> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    if (!this.store.has(key)) return 0;
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return 0;
    let deleted = 0;
    for (const field of fields) {
      if (hashFields.delete(field)) deleted++;
    }
    this.cleanupHashIfEmpty(key);
    return deleted;
  }

  async hgetall(key: string): Promise<Array<{ field: string; value: string }>> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return [];
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return [];
    const result: Array<{ field: string; value: string }> = [];
    for (const [field, entry] of fields) {
      result.push({ field, value: entry.value });
    }
    return result;
  }

  async hkeys(key: string): Promise<string[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return [];
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return [];
    return Array.from(fields.keys());
  }

  async hvals(key: string): Promise<string[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return [];
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return [];
    return Array.from(fields.values()).map(e => e.value);
  }

  async hlen(key: string): Promise<number> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return 0;
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return 0;
    return fields.size;
  }

  async hexists(key: string, field: string): Promise<boolean> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return false;
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return false;
    return fields.has(field);
  }

  async hsetnx(key: string, field: string, value: string): Promise<boolean> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.ensureHashTypeOrThrow(key);
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'hash', expiresAt: null });
    }
    if (!this.hashStore.has(key)) {
      this.hashStore.set(key, new Map());
    }
    const fields = this.hashStore.get(key)!;
    if (fields.has(field)) return false;
    fields.set(field, { value, expiresAt: null });
    return true;
  }

  async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => null);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => null);
    return fields.map(f => {
      const entry = hashFields.get(f);
      return entry?.value ?? null;
    });
  }

  async hincrby(key: string, field: string, delta: number): Promise<number> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.ensureHashTypeOrThrow(key);
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'hash', expiresAt: null });
    }
    if (!this.hashStore.has(key)) {
      this.hashStore.set(key, new Map());
    }
    const fields = this.hashStore.get(key)!;
    let current = 0;
    let existingExpiresAt: number | null = null;
    if (fields.has(field)) {
      const parsed = parseInt(fields.get(field)!.value, 10);
      if (isNaN(parsed) || !Number.isInteger(parsed)) {
        throw new Error('ERR value is not an integer or out of range');
      }
      current = parsed;
      existingExpiresAt = fields.get(field)!.expiresAt;
    }
    const result = current + delta;
    fields.set(field, { value: String(result), expiresAt: existingExpiresAt });
    return result;
  }

  async hincrbyfloat(key: string, field: string, delta: number): Promise<string> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.ensureHashTypeOrThrow(key);
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'hash', expiresAt: null });
    }
    if (!this.hashStore.has(key)) {
      this.hashStore.set(key, new Map());
    }
    const fields = this.hashStore.get(key)!;
    let current = 0;
    let existingExpiresAt: number | null = null;
    if (fields.has(field)) {
      const parsed = parseFloat(fields.get(field)!.value);
      if (isNaN(parsed)) {
        throw new Error('ERR value is not a valid float');
      }
      current = parsed;
      existingExpiresAt = fields.get(field)!.expiresAt;
    }
    const result = current + delta;
    if (isNaN(result)) {
      throw new Error('ERR value is not a valid float');
    }
    let resultStr = parseFloat(result.toPrecision(15)).toString();
    fields.set(field, { value: resultStr, expiresAt: existingExpiresAt });
    return resultStr;
  }

  async hrandfield(key: string, count: number): Promise<string[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return [];
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return [];
    const fieldNames = Array.from(fields.keys());
    if (fieldNames.length === 0) return [];
    if (count === 0) return [];
    if (count > 0) {
      const shuffled = [...fieldNames];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, Math.min(count, shuffled.length));
    } else {
      const result: string[] = [];
      for (let i = 0; i < Math.abs(count); i++) {
        result.push(fieldNames[Math.floor(Math.random() * fieldNames.length)]);
      }
      return result;
    }
  }

  async hscan(cursor: number, key: string, pattern?: string, count?: number): Promise<{ cursor: number; items: Array<{ field: string; value: string }> }> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return { cursor: 0, items: [] };
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return { cursor: 0, items: [] };
    const effectiveCount = count ?? 10;
    const allEntries = Array.from(fields.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const regex = pattern ? this.hashGlobToRegex(pattern) : null;
    const matchedItems: Array<{ field: string; value: string }> = [];
    let idx = cursor;
    while (idx < allEntries.length && matchedItems.length < effectiveCount) {
      const [field, entry] = allEntries[idx];
      if (!regex || regex.test(field)) {
        matchedItems.push({ field, value: entry.value });
      }
      idx++;
    }
    const nextCursor = idx >= allEntries.length ? 0 : idx;
    return { cursor: nextCursor, items: matchedItems };
  }

  async hstrlen(key: string, field: string): Promise<number> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return 0;
    this.ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return 0;
    const entry = fields.get(field);
    return entry?.value.length ?? 0;
  }

  async hgetdel(key: string, fields: string[]): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    if (!this.store.has(key)) return fields.map(() => null);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => null);
    const result: (string | null)[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      result.push(entry?.value ?? null);
      hashFields.delete(field);
    }
    this.cleanupHashIfEmpty(key);
    return result;
  }

  async hgetex(key: string, fields: string[], options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    if (!this.store.has(key)) return fields.map(() => null);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => null);
    const result: (string | null)[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      result.push(entry?.value ?? null);
      if (entry && options) {
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
    }
    return result;
  }

  async hsetex(key: string, pairs: Array<{ field: string; value: string }>, options?: { ex?: number; px?: number; exat?: number; pxat?: number; keepttl?: boolean }): Promise<number> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.ensureHashTypeOrThrow(key);
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'hash', expiresAt: null });
    }
    if (!this.hashStore.has(key)) {
      this.hashStore.set(key, new Map());
    }
    const hashFields = this.hashStore.get(key)!;
    let newCount = 0;

    let calculatedExpiresAt: number | null = null;
    if (options) {
      if (options.ex !== undefined) calculatedExpiresAt = Date.now() + options.ex * 1000;
      else if (options.px !== undefined) calculatedExpiresAt = Date.now() + options.px;
      else if (options.exat !== undefined) calculatedExpiresAt = options.exat * 1000;
      else if (options.pxat !== undefined) calculatedExpiresAt = options.pxat;
      // keepttl = true means preserve existing expiresAt, no new calculatedExpiresAt
      // No options means expiresAt = null
    }

    for (const { field, value } of pairs) {
      if (hashFields.has(field)) {
        if (options?.keepttl) {
          const existing = hashFields.get(field)!;
          hashFields.set(field, { value, expiresAt: existing.expiresAt });
        } else {
          hashFields.set(field, { value, expiresAt: calculatedExpiresAt });
        }
      } else {
        if (options?.keepttl) {
          hashFields.set(field, { value, expiresAt: null });
        } else {
          hashFields.set(field, { value, expiresAt: calculatedExpiresAt });
        }
        newCount++;
      }
    }
    return newCount;
  }

  async hexpire(key: string, fields: string[], seconds: number): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => 2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else {
        entry.expiresAt = Date.now() + seconds * 1000;
        results.push(1);
      }
    }
    return results;
  }

  async hexpireat(key: string, fields: string[], timestamp: number): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => 2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else {
        entry.expiresAt = timestamp * 1000;
        results.push(1);
      }
    }
    return results;
  }

  async hpexpire(key: string, fields: string[], milliseconds: number): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => 2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else {
        entry.expiresAt = Date.now() + milliseconds;
        results.push(1);
      }
    }
    return results;
  }

  async hpexpireat(key: string, fields: string[], msTimestamp: number): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => 2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else {
        entry.expiresAt = msTimestamp;
        results.push(1);
      }
    }
    return results;
  }

  async hexpiretime(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else if (entry.expiresAt === null) {
        results.push(-1);
      } else {
        results.push(Math.floor(entry.expiresAt / 1000));
      }
    }
    return results;
  }

  async hpexpiretime(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else if (entry.expiresAt === null) {
        results.push(-1);
      } else {
        results.push(entry.expiresAt);
      }
    }
    return results;
  }

  async hpersist(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else if (entry.expiresAt === null) {
        results.push(-1);
      } else {
        entry.expiresAt = null;
        results.push(1);
      }
    }
    return results;
  }

  async httl(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    const now = Date.now();
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else if (entry.expiresAt === null) {
        results.push(-1);
      } else {
        const remaining = Math.ceil((entry.expiresAt - now) / 1000);
        if (remaining <= 0) {
          hashFields.delete(field);
          this.cleanupHashIfEmpty(key);
          results.push(0);
        } else {
          results.push(remaining);
        }
      }
    }
    return results;
  }

  async hpttl(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this.ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => 0);
    const results: number[] = [];
    const now = Date.now();
    for (const field of fields) {
      const entry = hashFields.get(field);
      if (!entry) {
        results.push(0);
      } else if (entry.expiresAt === null) {
        results.push(-1);
      } else {
        const remaining = entry.expiresAt - now;
        if (remaining <= 0) {
          hashFields.delete(field);
          this.cleanupHashIfEmpty(key);
          results.push(0);
        } else {
          results.push(remaining);
        }
      }
    }
    return results;
  }

  // === List helpers ===

  private ensureListTypeOrThrow(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private ensureListKeyExists(key: string): void {
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'list', expiresAt: null });
    }
    if (!this.listStore.has(key)) {
      this.listStore.set(key, []);
    }
  }

  private cleanupListIfEmpty(key: string): void {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'list') return;
    const list = this.listStore.get(key);
    if (!list || list.length === 0) {
      this.listStore.delete(key);
      this.store.delete(key);
    }
  }

  // === List operations ===

  async lpush(key: string, elements: string[]): Promise<number> {
    this.evictIfExpired(key);
    this.ensureListTypeOrThrow(key);
    this.ensureListKeyExists(key);
    const list = this.listStore.get(key)!;
    for (const el of elements) {
      list.unshift(el);
    }
    return list.length;
  }

  async rpush(key: string, elements: string[]): Promise<number> {
    this.evictIfExpired(key);
    this.ensureListTypeOrThrow(key);
    this.ensureListKeyExists(key);
    const list = this.listStore.get(key)!;
    list.push(...elements);
    return list.length;
  }

  async lpop(key: string, count?: number): Promise<string | string[] | null> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return count !== undefined ? null : null;
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list || list.length === 0) {
      this.cleanupListIfEmpty(key);
      return count !== undefined ? null : null;
    }
    if (count === undefined || count === 1) {
      const val = list.shift()!;
      this.cleanupListIfEmpty(key);
      return val;
    }
    const result: string[] = [];
    for (let i = 0; i < count && list.length > 0; i++) {
      result.push(list.shift()!);
    }
    this.cleanupListIfEmpty(key);
    return result;
  }

  async rpop(key: string, count?: number): Promise<string | string[] | null> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return null;
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list || list.length === 0) {
      this.cleanupListIfEmpty(key);
      return null;
    }
    if (count === undefined || count === 1) {
      const val = list.pop()!;
      this.cleanupListIfEmpty(key);
      return val;
    }
    const result: string[] = [];
    for (let i = 0; i < count && list.length > 0; i++) {
      result.push(list.pop()!);
    }
    this.cleanupListIfEmpty(key);
    return result;
  }

  async llen(key: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    return list ? list.length : 0;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return [];
    this.ensureListTypeOrThrow(key);
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
  }

  async lindex(key: string, index: number): Promise<string | null> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return null;
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return null;
    let idx = index;
    if (idx < 0) idx = list.length + idx;
    if (idx < 0 || idx >= list.length) return null;
    return list[idx];
  }

  async lset(key: string, index: number, element: string): Promise<void> {
    this.evictIfExpired(key);
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) throw new Error('ERR no such key');
    let idx = index;
    if (idx < 0) idx = list.length + idx;
    if (idx < 0 || idx >= list.length) throw new Error('ERR index out of range');
    list[idx] = element;
  }

  async lrem(key: string, count: number, element: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this.ensureListTypeOrThrow(key);
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
    this.cleanupListIfEmpty(key);
    return removed;
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return;
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return;
    const len = list.length;
    let s = start;
    let e = stop;
    if (s < 0) s = Math.max(len + s, 0);
    if (e < 0) e = len + e;
    if (s > e || s >= len) {
      list.length = 0;
      this.cleanupListIfEmpty(key);
      return;
    }
    if (e >= len) e = len - 1;
    const trimmed = list.slice(s, e + 1);
    list.length = 0;
    list.push(...trimmed);
    this.cleanupListIfEmpty(key);
  }

  async lpos(key: string, element: string, options?: { rank?: number; maxlen?: number }): Promise<number | null> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return null;
    this.ensureListTypeOrThrow(key);
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
  }

  async rpoplpush(source: string, destination: string): Promise<string | null> {
    this.evictIfExpired(source);
    this.evictIfExpired(destination);
    this.ensureListTypeOrThrow(source);
    this.ensureListTypeOrThrow(destination);
    const srcList = this.listStore.get(source);
    if (!srcList || srcList.length === 0) return null;
    const val = srcList.pop()!;
    this.ensureListKeyExists(destination);
    const destList = this.listStore.get(destination)!;
    destList.unshift(val);
    this.cleanupListIfEmpty(source);
    return val;
  }

  async lpushx(key: string, element: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return 0;
    list.unshift(element);
    return list.length;
  }

  async rpushx(key: string, element: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return 0;
    list.push(element);
    return list.length;
  }

  async linsert(key: string, position: 'BEFORE' | 'AFTER', pivot: string, element: string): Promise<number> {
    this.evictIfExpired(key);
    if (!this.store.has(key)) return 0;
    this.ensureListTypeOrThrow(key);
    const list = this.listStore.get(key);
    if (!list) return 0;
    const pivotIndex = list.indexOf(pivot);
    if (pivotIndex === -1) return -1;
    const insertIndex = position === 'BEFORE' ? pivotIndex : pivotIndex + 1;
    list.splice(insertIndex, 0, element);
    return list.length;
  }

  async lmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT'): Promise<string | null> {
    this.evictIfExpired(source);
    this.evictIfExpired(destination);
    this.ensureListTypeOrThrow(source);
    this.ensureListTypeOrThrow(destination);
    const srcList = this.listStore.get(source);
    if (!srcList || srcList.length === 0) return null;
    const val = srcDir === 'LEFT' ? srcList.shift()! : srcList.pop()!;
    this.ensureListKeyExists(destination);
    const destList = this.listStore.get(destination)!;
    if (destDir === 'LEFT') {
      destList.unshift(val);
    } else {
      destList.push(val);
    }
    this.cleanupListIfEmpty(source);
    return val;
  }

  async blpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null> {
    for (const key of keys) {
      this.evictIfExpired(key);
      this.ensureListTypeOrThrow(key);
      if (this.store.has(key)) {
        const list = this.listStore.get(key);
        if (list && list.length > 0) {
          const val = list.shift()!;
          this.cleanupListIfEmpty(key);
          return { key, element: val };
        }
      }
    }
    return null;
  }

  async brpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null> {
    for (const key of keys) {
      this.evictIfExpired(key);
      this.ensureListTypeOrThrow(key);
      if (this.store.has(key)) {
        const list = this.listStore.get(key);
        if (list && list.length > 0) {
          const val = list.pop()!;
          this.cleanupListIfEmpty(key);
          return { key, element: val };
        }
      }
    }
    return null;
  }

  async brpoplpush(source: string, destination: string, timeout: number): Promise<string | null> {
    return this.rpoplpush(source, destination);
  }

  async blmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT', timeout: number): Promise<string | null> {
    return this.lmove(source, destination, srcDir, destDir);
  }

  async lmpop(numkeys: number, keys: string[], dir: 'LEFT' | 'RIGHT', count?: number): Promise<{ key: string; elements: string[] } | null> {
    const effectiveCount = count ?? 1;
    for (const key of keys) {
      this.evictIfExpired(key);
      this.ensureListTypeOrThrow(key);
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
          this.cleanupListIfEmpty(key);
          return { key, elements };
        }
      }
    }
    return null;
  }

  // === Set helpers ===

  private ensureSetTypeOrThrow(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.type !== 'set') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private cleanupSetIfEmpty(key: string): void {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'set') return;
    const set = this.setStore.get(key);
    if (!set || set.size === 0) {
      this.setStore.delete(key);
      this.store.delete(key);
    }
  }

  // === Set operations ===

  async sadd(key: string, members: string[]): Promise<number> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
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
  }

  async srem(key: string, members: string[]): Promise<number> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed++;
    }
    this.cleanupSetIfEmpty(key);
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set) return [];
    return Array.from(set);
  }

  async scard(key: string): Promise<number> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    return set ? set.size : 0;
  }

  async sismember(key: string, member: string): Promise<boolean> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    return set ? set.has(member) : false;
  }

  async smismember(key: string, members: string[]): Promise<boolean[]> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set) return members.map(() => false);
    return members.map(m => set.has(m));
  }

  async srandmember(key: string, count?: number): Promise<string[]> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
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
  }

  async spop(key: string, count?: number): Promise<string[]> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
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
    this.cleanupSetIfEmpty(key);
    return popped;
  }

  async smove(source: string, destination: string, member: string): Promise<boolean> {
    this.evictIfExpired(source);
    this.evictIfExpired(destination);
    this.ensureSetTypeOrThrow(source);
    this.ensureSetTypeOrThrow(destination);
    const srcSet = this.setStore.get(source);
    if (!srcSet || !srcSet.has(member)) return false;
    srcSet.delete(member);
    if (source === destination) {
      // Same key: re-add to same set (no visible change)
      srcSet.add(member);
      this.cleanupSetIfEmpty(source);
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
    this.cleanupSetIfEmpty(source);
    return true;
  }

  async sdiff(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
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
  }

  async sinter(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
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
  }

  async sunion(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
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
  }

  async sdiffstore(destination: string, keys: string[]): Promise<number> {
    this.evictIfExpired(destination);
    this.ensureSetTypeOrThrow(destination);
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
  }

  async sinterstore(destination: string, keys: string[]): Promise<number> {
    this.evictIfExpired(destination);
    this.ensureSetTypeOrThrow(destination);
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
  }

  async sunionstore(destination: string, keys: string[]): Promise<number> {
    this.evictIfExpired(destination);
    this.ensureSetTypeOrThrow(destination);
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
  }

  async sintercard(keys: string[], limit?: number): Promise<number> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
    const inter = await this.sinter(keys);
    if (limit !== undefined) {
      return Math.min(inter.length, limit);
    }
    return inter.length;
  }

  async sscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]> {
    this.evictIfExpired(key);
    this.ensureSetTypeOrThrow(key);
    const set = this.setStore.get(key);
    if (!set) return [0, []];
    const allMembers = Array.from(set).sort();
    const effectiveCount = count ?? 10;
    let idx = cursor;
    let scanned = 0;
    const regex = pattern ? this.hashGlobToRegex(pattern) : null;
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
  }

  // === Sorted Set helpers ===

  private ensureZsetTypeOrThrow(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private ensureZsetKeyExists(key: string): void {
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'zset', expiresAt: null });
    }
    if (!this.zsetStore.has(key)) {
      this.zsetStore.set(key, new Map());
    }
  }

  private cleanupZsetIfEmpty(key: string): void {
    const entry = this.store.get(key);
    // CRITICAL: must check type === 'zset' before deleting (Phase 2 bug pattern)
    if (!entry || entry.type !== 'zset') return;
    const zset = this.zsetStore.get(key);
    if (!zset || zset.size === 0) {
      this.zsetStore.delete(key);
      this.store.delete(key);
    }
  }

  private sortedMembers(key: string): Array<{ member: string; score: number }> {
    const zset = this.zsetStore.get(key);
    if (!zset) return [];
    return Array.from(zset.entries())
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
  }

  private parseScoreBound(bound: number | string, _isMin: boolean): { value: number; exclusive: boolean } {
    if (typeof bound === 'number') return { value: bound, exclusive: false };
    const str = String(bound);
    if (str === '-inf') return { value: -Infinity, exclusive: false };
    if (str === '+inf' || str === 'inf') return { value: Infinity, exclusive: false };
    if (str.startsWith('(')) {
      return { value: parseFloat(str.slice(1)), exclusive: true };
    }
    return { value: parseFloat(str), exclusive: false };
  }

  private parseLexBound(bound: string): { value: string; exclusive: boolean; infinite: boolean } {
    if (bound === '-') return { value: '', exclusive: false, infinite: true };
    if (bound === '+') return { value: '\uffff', exclusive: false, infinite: true };
    if (bound.startsWith('[')) return { value: bound.slice(1), exclusive: false, infinite: false };
    if (bound.startsWith('(')) return { value: bound.slice(1), exclusive: true, infinite: false };
    return { value: bound, exclusive: false, infinite: false };
  }

  private scoreInRange(score: number, min: { value: number; exclusive: boolean }, max: { value: number; exclusive: boolean }): boolean {
    const minOk = min.exclusive ? score > min.value : score >= min.value;
    const maxOk = max.exclusive ? score < max.value : score <= max.value;
    return minOk && maxOk;
  }

  private memberInLexRange(member: string, min: { value: string; exclusive: boolean; infinite: boolean }, max: { value: string; exclusive: boolean; infinite: boolean }): boolean {
    const minOk = min.infinite || (min.exclusive ? member > min.value : member >= min.value);
    const maxOk = max.infinite || (max.exclusive ? member < max.value : member <= max.value);
    return minOk && maxOk;
  }

  private formatScore(score: number): string {
    return parseFloat(score.toPrecision(15)).toString();
  }

  // === Sorted Set operations ===

  async zadd(key: string, scoreMembers: Array<{ score: number; member: string }>, options?: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean; ch?: boolean; incr?: boolean }): Promise<number | string | null> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);

    if (options?.incr) {
      // INCR mode: only one score-member pair allowed
      const { score, member } = scoreMembers[0];
      const zset = this.zsetStore.get(key);
      if (!zset || !zset.has(member)) {
        // Member doesn't exist
        if (options.xx) return null; // XX: only update existing
        this.ensureZsetKeyExists(key);
        const newZset = this.zsetStore.get(key)!;
        newZset.set(member, score);
        return this.formatScore(score);
      } else {
        // Member exists
        if (options.nx) return null; // NX: only add new
        const current = zset.get(member)!;
        let newScore: number;
        if (options.gt && score <= 0) return this.formatScore(current); // GT but increment not greater
        if (options.lt && score >= 0) return this.formatScore(current); // LT but increment not lesser
        if (options.gt && current + score <= current) return this.formatScore(current);
        if (options.lt && current + score >= current) return this.formatScore(current);
        newScore = current + score;
        zset.set(member, newScore);
        return this.formatScore(newScore);
      }
    }

    // Non-INCR mode
    let added = 0;
    let changed = 0;
    for (const { score, member } of scoreMembers) {
      const zset = this.zsetStore.get(key);
      if (!zset || !zset.has(member)) {
        // Member doesn't exist
        if (options?.xx) continue; // XX: only update existing
        this.ensureZsetKeyExists(key);
        this.zsetStore.get(key)!.set(member, score);
        added++;
      } else {
        // Member exists
        if (options?.nx) continue; // NX: only add new
        const current = zset.get(member)!;
        if (options?.gt && score <= current) continue; // GT: only update if new score > current
        if (options?.lt && score >= current) continue; // LT: only update if new score < current
        if (current !== score) changed++;
        zset.set(member, score);
      }
    }
    return options?.ch ? added + changed : added;
  }

  async zrem(key: string, members: string[]): Promise<number> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return 0;
    let removed = 0;
    for (const member of members) {
      if (zset.delete(member)) removed++;
    }
    this.cleanupZsetIfEmpty(key);
    return removed;
  }

  async zscore(key: string, member: string): Promise<string | null> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return null;
    const score = zset.get(member);
    return score !== undefined ? this.formatScore(score) : null;
  }

  async zcard(key: string): Promise<number> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    return zset ? zset.size : 0;
  }

  async zrange(key: string, min: number | string, max: number | string, options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }): Promise<Array<{ member: string; score: number }>> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const sorted = this.sortedMembers(key);
    if (sorted.length === 0) return [];

    let filtered: Array<{ member: string; score: number }>;

    if (options?.byScore) {
      // Score mode
      const rev = options?.rev ?? false;
      const parsedMin = this.parseScoreBound(min, true);
      const parsedMax = this.parseScoreBound(max, false);
      // For rev, swap bounds
      if (rev) {
        filtered = sorted.filter(item => this.scoreInRange(item.score, parsedMax, parsedMin));
        filtered.reverse();
      } else {
        filtered = sorted.filter(item => this.scoreInRange(item.score, parsedMin, parsedMax));
      }
    } else if (options?.byLex) {
      // Lex mode
      const rev = options?.rev ?? false;
      const parsedMin = this.parseLexBound(String(min));
      const parsedMax = this.parseLexBound(String(max));
      if (rev) {
        filtered = sorted.filter(item => this.memberInLexRange(item.member, parsedMax, parsedMin));
        filtered.reverse();
      } else {
        filtered = sorted.filter(item => this.memberInLexRange(item.member, parsedMin, parsedMax));
      }
    } else {
      // Index mode
      let arr = options?.rev ? [...sorted].reverse() : sorted;
      let start = typeof min === 'number' ? min : parseInt(String(min), 10);
      let stop = typeof max === 'number' ? max : parseInt(String(max), 10);
      const len = arr.length;
      if (start < 0) start = Math.max(len + start, 0);
      if (stop < 0) stop = len + stop;
      if (start > stop || start >= len) return [];
      if (stop >= len) stop = len - 1;
      filtered = arr.slice(start, stop + 1);
    }

    // Apply offset/count
    if (options?.offset !== undefined || options?.count !== undefined) {
      const offset = options?.offset ?? 0;
      const count = options?.count ?? filtered.length;
      filtered = filtered.slice(offset, offset + count);
    }

    return filtered;
  }

  async zrank(key: string, member: string): Promise<number | null> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const sorted = this.sortedMembers(key);
    const idx = sorted.findIndex(item => item.member === member);
    return idx >= 0 ? idx : null;
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const sorted = this.sortedMembers(key);
    const idx = sorted.findIndex(item => item.member === member);
    if (idx < 0) return null;
    return sorted.length - 1 - idx;
  }

  async zincrby(key: string, increment: number, member: string): Promise<string> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    this.ensureZsetKeyExists(key);
    const zset = this.zsetStore.get(key)!;
    const current = zset.get(member) ?? 0;
    const newScore = current + increment;
    zset.set(member, newScore);
    return this.formatScore(newScore);
  }

  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const sorted = this.sortedMembers(key);
    const parsedMin = this.parseScoreBound(min, true);
    const parsedMax = this.parseScoreBound(max, false);
    return sorted.filter(item => this.scoreInRange(item.score, parsedMin, parsedMax)).length;
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return 0;
    const sorted = this.sortedMembers(key);
    const len = sorted.length;
    let s = start;
    let e = stop;
    if (s < 0) s = Math.max(len + s, 0);
    if (e < 0) e = len + e;
    if (s > e || s >= len) return 0;
    if (e >= len) e = len - 1;
    const toRemove = sorted.slice(s, e + 1);
    for (const item of toRemove) {
      zset.delete(item.member);
    }
    this.cleanupZsetIfEmpty(key);
    return toRemove.length;
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return 0;
    const sorted = this.sortedMembers(key);
    const parsedMin = this.parseScoreBound(min, true);
    const parsedMax = this.parseScoreBound(max, false);
    const toRemove = sorted.filter(item => this.scoreInRange(item.score, parsedMin, parsedMax));
    for (const item of toRemove) {
      zset.delete(item.member);
    }
    this.cleanupZsetIfEmpty(key);
    return toRemove.length;
  }

  async zremrangebylex(key: string, min: string, max: string): Promise<number> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return 0;
    const sorted = this.sortedMembers(key);
    const parsedMin = this.parseLexBound(min);
    const parsedMax = this.parseLexBound(max);
    const toRemove = sorted.filter(item => this.memberInLexRange(item.member, parsedMin, parsedMax));
    for (const item of toRemove) {
      zset.delete(item.member);
    }
    this.cleanupZsetIfEmpty(key);
    return toRemove.length;
  }

  async zlexcount(key: string, min: string, max: string): Promise<number> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const sorted = this.sortedMembers(key);
    const parsedMin = this.parseLexBound(min);
    const parsedMax = this.parseLexBound(max);
    return sorted.filter(item => this.memberInLexRange(item.member, parsedMin, parsedMax)).length;
  }

  async zscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return [0, []];
    const sorted = this.sortedMembers(key);
    if (sorted.length === 0) return [0, []];
    const effectiveCount = count ?? 10;
    const regex = pattern ? this.hashGlobToRegex(pattern) : null;
    const result: string[] = [];
    let idx = cursor;
    while (idx < sorted.length && result.length < effectiveCount * 2) {
      const item = sorted[idx];
      idx++;
      if (!regex || regex.test(item.member)) {
        result.push(item.member, this.formatScore(item.score));
      }
    }
    const nextCursor = idx >= sorted.length ? 0 : idx;
    return [nextCursor, result];
  }

  async zpopmax(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset || zset.size === 0) return [];
    const sorted = this.sortedMembers(key);
    const actualCount = count ?? 1;
    const toPop = sorted.slice(-actualCount).reverse(); // highest scores first in result
    for (const item of toPop) {
      zset.delete(item.member);
    }
    this.cleanupZsetIfEmpty(key);
    return toPop;
  }

  async zpopmin(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset || zset.size === 0) return [];
    const sorted = this.sortedMembers(key);
    const actualCount = count ?? 1;
    const toPop = sorted.slice(0, actualCount);
    for (const item of toPop) {
      zset.delete(item.member);
    }
    this.cleanupZsetIfEmpty(key);
    return toPop;
  }

  async zrandmember(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset || zset.size === 0) return [];
    const entries = Array.from(zset.entries()).map(([member, score]) => ({ member, score }));
    if (count === undefined) {
      const item = entries[Math.floor(Math.random() * entries.length)];
      return [item];
    }
    if (count > 0) {
      const shuffled = [...entries];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, Math.min(count, shuffled.length));
    } else {
      const result: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < Math.abs(count); i++) {
        result.push(entries[Math.floor(Math.random() * entries.length)]);
      }
      return result;
    }
  }

  async zmscore(key: string, members: string[]): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return members.map(() => null);
    return members.map(member => {
      const score = zset.get(member);
      return score !== undefined ? this.formatScore(score) : null;
    });
  }

  async zrangestore(destination: string, source: string, min: number | string, max: number | string, options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }): Promise<number> {
    this.evictIfExpired(destination);
    this.evictIfExpired(source);
    this.ensureZsetTypeOrThrow(source);
    this.ensureZsetTypeOrThrow(destination);
    const range = await this.zrange(source, min, max, options);
    if (range.length === 0) {
      // Delete destination if it's a zset
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this.ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    destZset.clear();
    for (const item of range) {
      destZset.set(item.member, item.score);
    }
    return range.length;
  }

  async zdiff(keys: string[]): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const firstZset = this.zsetStore.get(keys[0]);
    if (!firstZset) return [];
    const firstEntries = new Map(firstZset); // copy
    for (let i = 1; i < keys.length; i++) {
      const otherZset = this.zsetStore.get(keys[i]);
      if (otherZset) {
        for (const member of otherZset.keys()) {
          firstEntries.delete(member);
        }
      }
    }
    const result: Array<{ member: string; score: number }> = [];
    for (const [member, score] of firstEntries) {
      result.push({ member, score });
    }
    result.sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
    return result;
  }

  async zdiffstore(destination: string, keys: string[]): Promise<number> {
    this.evictIfExpired(destination);
    for (const key of keys) this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(destination);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    const diff = await this.zdiff(keys);
    if (diff.length === 0) {
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this.ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    destZset.clear();
    for (const item of diff) {
      destZset.set(item.member, item.score);
    }
    return diff.length;
  }

  async zunion(keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const weights = options?.weights ?? keys.map(() => 1);
    const aggregate = options?.aggregate ?? 'SUM';
    const memberScores = new Map<string, number[]>();
    for (let i = 0; i < keys.length; i++) {
      const zset = this.zsetStore.get(keys[i]);
      const weight = weights[i] ?? 1;
      if (!zset) continue;
      for (const [member, score] of zset) {
        if (!memberScores.has(member)) memberScores.set(member, []);
        memberScores.get(member)!.push(score * weight);
      }
    }
    const result: Array<{ member: string; score: number }> = [];
    for (const [member, scores] of memberScores) {
      let finalScore: number;
      if (aggregate === 'MIN') {
        finalScore = Math.min(...scores);
      } else if (aggregate === 'MAX') {
        finalScore = Math.max(...scores);
      } else {
        finalScore = scores.reduce((a, b) => a + b, 0);
      }
      result.push({ member, score: finalScore });
    }
    result.sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
    return result;
  }

  async zunionstore(destination: string, keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<number> {
    this.evictIfExpired(destination);
    for (const key of keys) this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(destination);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    const union = await this.zunion(keys, options);
    if (union.length === 0) {
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this.ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    destZset.clear();
    for (const item of union) {
      destZset.set(item.member, item.score);
    }
    return union.length;
  }

  async zinter(keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const weights = options?.weights ?? keys.map(() => 1);
    const aggregate = options?.aggregate ?? 'SUM';
    // Collect member -> [weighted scores per key they appear in]
    const memberKeyScores = new Map<string, Map<number, number>>(); // member -> (keyIndex -> weighted score)
    for (let i = 0; i < keys.length; i++) {
      const zset = this.zsetStore.get(keys[i]);
      if (!zset) continue;
      for (const [member, score] of zset) {
        if (!memberKeyScores.has(member)) memberKeyScores.set(member, new Map());
        memberKeyScores.get(member)!.set(i, score * (weights[i] ?? 1));
      }
    }
    const result: Array<{ member: string; score: number }> = [];
    for (const [member, keyScores] of memberKeyScores) {
      // Only include members present in ALL keys
      if (keyScores.size < keys.length) continue;
      const scores = Array.from(keyScores.values());
      let finalScore: number;
      if (aggregate === 'MIN') {
        finalScore = Math.min(...scores);
      } else if (aggregate === 'MAX') {
        finalScore = Math.max(...scores);
      } else {
        finalScore = scores.reduce((a, b) => a + b, 0);
      }
      result.push({ member, score: finalScore });
    }
    result.sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
    return result;
  }

  async zinterstore(destination: string, keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<number> {
    this.evictIfExpired(destination);
    for (const key of keys) this.evictIfExpired(key);
    this.ensureZsetTypeOrThrow(destination);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    const inter = await this.zinter(keys, options);
    if (inter.length === 0) {
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this.ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    destZset.clear();
    for (const item of inter) {
      destZset.set(item.member, item.score);
    }
    return inter.length;
  }

  async zintercard(keys: string[], limit?: number): Promise<number> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return 0;
    // Intersection of member presence without weights/aggregate
    let memberSets: Set<string>[] = [];
    for (const key of keys) {
      const zset = this.zsetStore.get(key);
      if (!zset) return 0;
      memberSets.push(new Set(zset.keys()));
    }
    let result = memberSets[0];
    for (let i = 1; i < memberSets.length; i++) {
      const next = new Set<string>();
      for (const m of result) {
        if (memberSets[i].has(m)) next.add(m);
      }
      result = next;
    }
    const count = result.size;
    return limit !== undefined ? Math.min(count, limit) : count;
  }

  async bzpopmax(keys: string[], timeout: number): Promise<{ key: string; member: string; score: number } | null> {
    for (const key of keys) {
      this.evictIfExpired(key);
      this.ensureZsetTypeOrThrow(key);
      const zset = this.zsetStore.get(key);
      if (zset && zset.size > 0) {
        const sorted = this.sortedMembers(key);
        const item = sorted[sorted.length - 1]; // max
        zset.delete(item.member);
        this.cleanupZsetIfEmpty(key);
        return { key, member: item.member, score: item.score };
      }
    }
    return null;
  }

  async bzpopmin(keys: string[], timeout: number): Promise<{ key: string; member: string; score: number } | null> {
    for (const key of keys) {
      this.evictIfExpired(key);
      this.ensureZsetTypeOrThrow(key);
      const zset = this.zsetStore.get(key);
      if (zset && zset.size > 0) {
        const sorted = this.sortedMembers(key);
        const item = sorted[0]; // min
        zset.delete(item.member);
        this.cleanupZsetIfEmpty(key);
        return { key, member: item.member, score: item.score };
      }
    }
    return null;
  }

  async bzmpop(numkeys: number, keys: string[], minmax: 'MIN' | 'MAX', count?: number): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    const effectiveCount = count ?? 1;
    for (const key of keys) {
      this.evictIfExpired(key);
      this.ensureZsetTypeOrThrow(key);
      const zset = this.zsetStore.get(key);
      if (zset && zset.size > 0) {
        const sorted = this.sortedMembers(key);
        const elements: Array<{ member: string; score: number }> = [];
        if (minmax === 'MIN') {
          for (let i = 0; i < effectiveCount && i < sorted.length; i++) {
            elements.push(sorted[i]);
            zset.delete(sorted[i].member);
          }
        } else {
          for (let i = sorted.length - 1; i >= 0 && elements.length < effectiveCount; i--) {
            elements.push(sorted[i]);
            zset.delete(sorted[i].member);
          }
        }
        this.cleanupZsetIfEmpty(key);
        return { key, elements };
      }
    }
    return null;
  }

  async zmpop(numkeys: number, keys: string[], minmax: 'MIN' | 'MAX', count?: number): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    return this.bzmpop(numkeys, keys, minmax, count);
  }

  // === Bitmap helpers ===

  private stringToBytes(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i));
    }
    return bytes;
  }

  private bytesToString(bytes: number[]): string {
    return String.fromCharCode(...bytes);
  }

  private getBitAt(bytes: number[], offset: number): 0 | 1 {
    const byteIndex = Math.floor(offset / 8);
    const bitIndex = 7 - (offset % 8);
    if (byteIndex >= bytes.length) return 0;
    return ((bytes[byteIndex] >> bitIndex) & 1) as 0 | 1;
  }

  private setBitAt(bytes: number[], offset: number, value: 0 | 1): 0 | 1 {
    const byteIndex = Math.floor(offset / 8);
    const bitIndex = 7 - (offset % 8);
    while (bytes.length <= byteIndex) bytes.push(0);
    const oldVal = (bytes[byteIndex] >> bitIndex) & 1;
    if (value === 1) {
      bytes[byteIndex] |= (1 << bitIndex);
    } else {
      bytes[byteIndex] &= ~(1 << bitIndex);
    }
    return oldVal as 0 | 1;
  }

  private ensureStringTypeOrThrow(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private ensureHllTypeOrThrow(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.type !== 'hyperloglog') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private ensureJsonTypeOrThrow(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  // === HyperLogLog helpers ===

  private HLL_REGISTERS = 16384;
  private HLL_BYTES = 12288;

  private murmurHash64(str: string): bigint {
    let h1 = 0x9e3779b97f4a7c15n;
    for (let i = 0; i < str.length; i++) {
      h1 ^= BigInt(str.charCodeAt(i));
      h1 = (h1 * 0xbf58476d1ce4e5b9n) & 0xFFFFFFFFFFFFFFFFn;
      h1 = ((h1 ^ (h1 >> 31n)) & 0xFFFFFFFFFFFFFFFFn);
    }
    return h1;
  }

  private hllIndex(hash: bigint): number {
    return Number(hash & 0x3FFFn);
  }

  private hllRho(hash: bigint): number {
    const remaining = hash >> 14n;
    if (remaining === 0n) return 51;
    let count = 1;
    let val = remaining;
    while ((val & 1n) === 0n && count < 51) {
      count++;
      val >>= 1n;
    }
    return count;
  }

  private hllEncode(registers: Uint8Array): string {
    return Buffer.from(registers).toString('base64');
  }

  private hllDecode(data: string): Uint8Array {
    return new Uint8Array(Buffer.from(data, 'base64'));
  }

  private read6BitRegister(data: Uint8Array, index: number): number {
    const bitOffset = index * 6;
    const byteOffset = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;

    let value = 0;
    let bitsNeeded = 6;
    let currentByte = byteOffset;
    let currentBit = bitInByte;

    while (bitsNeeded > 0) {
      const bitsAvailable = 8 - currentBit;
      const bitsToRead = Math.min(bitsAvailable, bitsNeeded);
      const mask = ((1 << bitsToRead) - 1) << (bitsAvailable - bitsToRead);
      const bits = (data[currentByte] & mask) >> (bitsAvailable - bitsToRead);
      value = (value << bitsToRead) | bits;
      bitsNeeded -= bitsToRead;
      currentBit = 0;
      currentByte++;
    }

    return value;
  }

  private write6BitRegister(data: Uint8Array, index: number, value: number): void {
    const bitOffset = index * 6;
    const byteOffset = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;

    let bitsToWrite = 6;
    let currentByte = byteOffset;
    let currentBit = bitInByte;
    let shiftedValue = value;

    while (bitsToWrite > 0) {
      const bitsAvailable = 8 - currentBit;
      const bitsToWriteNow = Math.min(bitsAvailable, bitsToWrite);
      const mask = ((1 << bitsToWriteNow) - 1);
      const bits = (shiftedValue >> (bitsToWrite - bitsToWriteNow)) & mask;
      const shift = bitsAvailable - bitsToWriteNow;

      data[currentByte] &= ~(mask << shift);
      data[currentByte] |= (bits << shift);

      bitsToWrite -= bitsToWriteNow;
      currentBit = 0;
      currentByte++;
    }
  }

  private hllEstimate(registers: Uint8Array): number {
    const m = this.HLL_REGISTERS;
    let sum = 0;
    let zeros = 0;

    for (let i = 0; i < m; i++) {
      const regVal = this.read6BitRegister(registers, i);
      sum += 1 / Math.pow(2, regVal);
      if (regVal === 0) zeros++;
    }

    const alpha = 0.7213 / (1 + 1.079 / m);
    const estimate = alpha * m * m / sum;

    if (estimate <= 2.5 * m && zeros > 0) {
      return Math.round(m * Math.log(m / zeros));
    }

    return Math.max(0, Math.round(estimate));
  }

  // === JSON helpers ===

  private parseJsonPath(path: string): Array<{ type: 'field'; name: string } | { type: 'index'; index: number }> {
    let p = path;
    if (p === '$' || p === '.') return [];
    if (p.startsWith('$.')) p = p.slice(2);
    else if (p.startsWith('$')) p = p.slice(1);
    else if (p.startsWith('.')) p = p.slice(1);

    const segments: Array<{ type: 'field'; name: string } | { type: 'index'; index: number }> = [];
    let i = 0;
    while (i < p.length) {
      if (p[i] === '[') {
        const end = p.indexOf(']', i);
        if (end === -1) break;
        const content = p.slice(i + 1, end);
        if (/^\d+$/.test(content)) {
          segments.push({ type: 'index', index: parseInt(content) });
        } else {
          const fieldName = content.replace(/^['"]|['"]$/g, '');
          segments.push({ type: 'field', name: fieldName });
        }
        i = end + 1;
        if (i < p.length && p[i] === '.') i++;
      } else {
        let end = i;
        while (end < p.length && p[end] !== '.' && p[end] !== '[') end++;
        const fieldName = p.slice(i, end);
        if (fieldName) segments.push({ type: 'field', name: fieldName });
        i = end;
        if (i < p.length && p[i] === '.') i++;
      }
    }
    return segments;
  }

  private jsonResolvePath(root: any, path: string): { parent: any; key: string | number; value: any }[] {
    if (path === '$' || path === '.' || path === '') {
      return [{ parent: null, key: '', value: root }];
    }

    const segments = this.parseJsonPath(path);
    let current: { parent: any; key: string | number; value: any }[] = [{ parent: null, key: '', value: root }];

    for (const seg of segments) {
      const next: { parent: any; key: string | number; value: any }[] = [];
      for (const item of current) {
        if (seg.type === 'field') {
          if (item.value !== null && typeof item.value === 'object' && !Array.isArray(item.value) && seg.name in item.value) {
            next.push({ parent: item.value, key: seg.name, value: item.value[seg.name] });
          }
        } else if (seg.type === 'index') {
          if (Array.isArray(item.value) && seg.index < item.value.length && seg.index >= 0) {
            next.push({ parent: item.value, key: seg.index, value: item.value[seg.index] });
          }
        }
      }
      current = next;
    }
    return current;
  }

  private jsonTypeOf(val: any): string {
    if (val === null) return 'null';
    if (Array.isArray(val)) return 'array';
    if (typeof val === 'object') return 'object';
    if (typeof val === 'boolean') return 'boolean';
    if (typeof val === 'number') {
      return Number.isInteger(val) ? 'integer' : 'number';
    }
    if (typeof val === 'string') return 'string';
    return 'unknown';
  }

  // === Bitmap operations ===

  async setbit(key: string, offset: number, value: 0 | 1): Promise<number> {
    this.evictIfExpired(key);
    this.ensureStringTypeOrThrow(key);
    const entry = this.store.get(key);
    let current: string;
    let existingExpiresAt: number | null;

    if (!entry) {
      current = '';
      existingExpiresAt = null;
    } else {
      current = entry.value;
      existingExpiresAt = entry.expiresAt;
    }

    const bytes = this.stringToBytes(current);
    const oldBit = this.setBitAt(bytes, offset, value);
    const newValue = this.bytesToString(bytes);
    this.store.set(key, { value: newValue, type: 'string', expiresAt: existingExpiresAt });
    return oldBit;
  }

  async getbit(key: string, offset: number): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const bytes = this.stringToBytes(entry.value);
    return this.getBitAt(bytes, offset);
  }

  async bitcount(key: string, start?: number, end?: number): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const bytes = this.stringToBytes(entry.value);
    if (bytes.length === 0) return 0;
    let s = start ?? 0;
    let e = end ?? -1;
    if (s < 0) s = Math.max(bytes.length + s, 0);
    if (e < 0) e = bytes.length + e;
    if (s > e || s >= bytes.length) return 0;
    if (e >= bytes.length) e = bytes.length - 1;
    let count = 0;
    for (let i = s; i <= e; i++) {
      let b = bytes[i];
      while (b) {
        count += b & 1;
        b >>= 1;
      }
    }
    return count;
  }

  async bitpos(key: string, bit: 0 | 1, start?: number, end?: number): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return bit === 0 ? 0 : -1;
    if (entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const bytes = this.stringToBytes(entry.value);
    if (bytes.length === 0) return bit === 0 ? 0 : -1;
    let s = start ?? 0;
    let e = end ?? bytes.length - 1;
    if (s < 0) s = Math.max(bytes.length + s, 0);
    if (e < 0) e = bytes.length + e;
    if (s > e || s >= bytes.length) return -1;
    if (e >= bytes.length) e = bytes.length - 1;

    for (let i = s; i <= e; i++) {
      for (let j = 7; j >= 0; j--) {
        const b = (bytes[i] >> j) & 1;
        if (b === bit) return i * 8 + (7 - j);
      }
    }
    return -1;
  }

  async bitop(operation: 'AND' | 'OR' | 'XOR' | 'NOT', destkey: string, keys: string[]): Promise<number> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) {
      const entry = this.store.get(key);
      if (entry && entry.type !== 'string') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
      }
    }

    const srcArrays: number[][] = [];
    for (const key of keys) {
      const entry = this.store.get(key);
      srcArrays.push(entry ? this.stringToBytes(entry.value) : []);
    }

    let maxLen = 0;
    for (const arr of srcArrays) {
      if (arr.length > maxLen) maxLen = arr.length;
    }

    if (operation === 'NOT') {
      if (keys.length !== 1) {
        throw new Error('ERR BITOP NOT must have exactly one source key');
      }
      const src = srcArrays[0];
      const result: number[] = [];
      for (let i = 0; i < src.length; i++) {
        result.push((~src[i]) & 0xFF);
      }
      const resultStr = this.bytesToString(result);
      this.evictIfExpired(destkey);
      this.store.set(destkey, { value: resultStr, type: 'string', expiresAt: null });
      return result.length;
    }

    if (keys.length === 0) {
      this.evictIfExpired(destkey);
      this.store.delete(destkey);
      return 0;
    }

    const result: number[] = new Array(maxLen).fill(0);
    for (let i = 0; i < maxLen; i++) {
      if (operation === 'AND') {
        let val = 0xFF;
        for (const arr of srcArrays) {
          val &= (i < arr.length ? arr[i] : 0);
        }
        result[i] = val;
      } else if (operation === 'OR') {
        let val = 0;
        for (const arr of srcArrays) {
          val |= (i < arr.length ? arr[i] : 0);
        }
        result[i] = val;
      } else if (operation === 'XOR') {
        let val = 0;
        for (const arr of srcArrays) {
          val ^= (i < arr.length ? arr[i] : 0);
        }
        result[i] = val;
      }
    }

    const resultStr = this.bytesToString(result);
    this.evictIfExpired(destkey);
    this.store.set(destkey, { value: resultStr, type: 'string', expiresAt: null });
    return result.length;
  }

  async bitfield(key: string, operations: Array<{ type: 'GET' | 'SET' | 'INCRBY'; encoding: string; offset: number; value?: number; overflow?: 'WRAP' | 'SAT' | 'FAIL' }>): Promise<(number | null)[]> {
    this.evictIfExpired(key);
    this.ensureStringTypeOrThrow(key);
    const entry = this.store.get(key);
    let current: string;
    let existingExpiresAt: number | null;

    if (!entry) {
      current = '';
      existingExpiresAt = null;
    } else {
      current = entry.value;
      existingExpiresAt = entry.expiresAt;
    }

    const bytes = this.stringToBytes(current);
    const results: (number | null)[] = [];
    let currentOverflow: 'WRAP' | 'SAT' | 'FAIL' = 'WRAP';

    for (const op of operations) {
      // Update overflow setting if specified
      if (op.type !== 'GET' && op.overflow) {
        currentOverflow = op.overflow;
      }
      // Parse encoding
      const isSigned = op.encoding.toLowerCase().startsWith('i');
      const bits = parseInt(op.encoding.slice(1));

      if (bits < 1 || bits > 64 || (!isSigned && bits < 1) || (!isSigned && bits > 64)) {
        throw new Error('ERR invalid bitfield encoding');
      }

      const maxUnsigned = Math.pow(2, bits) - 1;
      const maxSigned = Math.pow(2, bits - 1) - 1;
      const minSigned = -Math.pow(2, bits - 1);

      const applyOverflow = (val: number): number | null => {
        if (isSigned) {
          if (val > maxSigned || val < minSigned) {
            if (currentOverflow === 'FAIL') return null;
            if (currentOverflow === 'SAT') {
              return val > maxSigned ? maxSigned : val < minSigned ? minSigned : val;
            }
            // WRAP
            const range = Math.pow(2, bits);
            return ((val + Math.pow(2, bits - 1)) % range + range) % range - Math.pow(2, bits - 1);
          }
          return val;
        } else {
          if (val < 0 || val > maxUnsigned) {
            if (currentOverflow === 'FAIL') return null;
            if (currentOverflow === 'SAT') {
              return val < 0 ? 0 : val > maxUnsigned ? maxUnsigned : val;
            }
            // WRAP
            return ((val % (maxUnsigned + 1)) + (maxUnsigned + 1)) % (maxUnsigned + 1);
          }
          return val;
        }
      };

      if (op.type === 'GET') {
        let val = 0;
        for (let b = 0; b < bits; b++) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          if (byteIdx < bytes.length) {
            val = (val << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
          } else {
            val = val << 1;
          }
        }
        if (isSigned && val > maxSigned) {
          val = val - Math.pow(2, bits);
        }
        results.push(val);
      } else if (op.type === 'SET') {
        // Get old value first
        let oldVal = 0;
        for (let b = 0; b < bits; b++) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          if (byteIdx < bytes.length) {
            oldVal = (oldVal << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
          }
        }
        if (isSigned && oldVal > maxSigned) {
          oldVal = oldVal - Math.pow(2, bits);
        }

        // Set new value
        const setValue = op.value!;
        let writeVal = isSigned ? (setValue < 0 ? setValue + Math.pow(2, bits) : setValue) : (setValue < 0 ? setValue + Math.pow(2, bits) : setValue);
        for (let b = bits - 1; b >= 0; b--) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          while (bytes.length <= byteIdx) bytes.push(0);
          const bit = (writeVal >> (bits - 1 - b)) & 1;
          if (bit === 1) {
            bytes[byteIdx] |= (1 << bitIdx);
          } else {
            bytes[byteIdx] &= ~(1 << bitIdx);
          }
        }

        results.push(oldVal);
      } else if (op.type === 'INCRBY') {
        // Get current value
        let currentVal = 0;
        for (let b = 0; b < bits; b++) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          if (byteIdx < bytes.length) {
            currentVal = (currentVal << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
          }
        }
        if (isSigned && currentVal > maxSigned) {
          currentVal = currentVal - Math.pow(2, bits);
        }

        const increment = op.value!;
        const newVal = currentVal + increment;
        const clampedVal = applyOverflow(newVal);
        if (clampedVal === null) {
          results.push(null);
          continue;
        }

        // Write back
        let writeVal = isSigned ? (clampedVal < 0 ? clampedVal + Math.pow(2, bits) : clampedVal) : clampedVal;
        for (let b = bits - 1; b >= 0; b--) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          while (bytes.length <= byteIdx) bytes.push(0);
          const bit = (writeVal >> (bits - 1 - b)) & 1;
          if (bit === 1) {
            bytes[byteIdx] |= (1 << bitIdx);
          } else {
            bytes[byteIdx] &= ~(1 << bitIdx);
          }
        }

        results.push(clampedVal);
      }
    }

    const newValue = this.bytesToString(bytes);
    this.store.set(key, { value: newValue, type: 'string', expiresAt: existingExpiresAt });
    return results;
  }

  async bitfieldRo(key: string, operations: Array<{ type: 'GET'; encoding: string; offset: number }>): Promise<(number | null)[]> {
    // bitfieldRo is read-only — no overflow state needed
    const opsWithOverflow: Array<{ type: 'GET' | 'SET' | 'INCRBY'; encoding: string; offset: number; value?: number; overflow?: 'WRAP' | 'SAT' | 'FAIL' }> = operations.map(op => ({
      ...op,
      overflow: 'WRAP' as const,
    }));
    return this.bitfield(key, opsWithOverflow);
  }

  // === HyperLogLog operations ===

  async pfadd(key: string, elements: string[]): Promise<number> {
    this.evictIfExpired(key);
    this.ensureHllTypeOrThrow(key);
    let entry = this.store.get(key);
    let registers: Uint8Array;

    if (!entry) {
      registers = new Uint8Array(this.HLL_BYTES);
      this.store.set(key, { value: this.hllEncode(registers), type: 'hyperloglog', expiresAt: null });
      entry = this.store.get(key)!;
    } else {
      registers = this.hllDecode(entry.value);
    }

    let changed = false;
    for (const el of elements) {
      const hash = this.murmurHash64(el);
      const idx = this.hllIndex(hash);
      const rho = this.hllRho(hash);
      const currentVal = this.read6BitRegister(registers, idx);
      if (rho > currentVal) {
        this.write6BitRegister(registers, idx, rho);
        changed = true;
      }
    }

    if (changed) {
      this.store.set(key, { value: this.hllEncode(registers), type: 'hyperloglog', expiresAt: entry.expiresAt });
    }
    return changed ? 1 : 0;
  }

  async pfcount(keys: string[]): Promise<number> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this.ensureHllTypeOrThrow(key);

    if (keys.length === 0) return 0;

    if (keys.length === 1) {
      const entry = this.store.get(keys[0]);
      if (!entry) return 0;
      const registers = this.hllDecode(entry.value);
      return this.hllEstimate(registers);
    }

    // Merge multiple HLLs
    const merged = new Uint8Array(this.HLL_BYTES);
    for (const key of keys) {
      const entry = this.store.get(key);
      if (!entry) continue;
      const registers = this.hllDecode(entry.value);
      for (let i = 0; i < this.HLL_REGISTERS; i++) {
        const val = this.read6BitRegister(registers, i);
        const currentVal = this.read6BitRegister(merged, i);
        if (val > currentVal) {
          this.write6BitRegister(merged, i, val);
        }
      }
    }
    return this.hllEstimate(merged);
  }

  async pfmerge(destkey: string, sourceKeys: string[]): Promise<void> {
    this.evictIfExpired(destkey);
    for (const key of sourceKeys) this.evictIfExpired(key);
    for (const key of sourceKeys) this.ensureHllTypeOrThrow(key);
    this.ensureHllTypeOrThrow(destkey);

    const merged = new Uint8Array(this.HLL_BYTES);
    let hasData = false;

    for (const key of sourceKeys) {
      const entry = this.store.get(key);
      if (!entry) continue;
      hasData = true;
      const registers = this.hllDecode(entry.value);
      for (let i = 0; i < this.HLL_REGISTERS; i++) {
        const val = this.read6BitRegister(registers, i);
        const currentVal = this.read6BitRegister(merged, i);
        if (val > currentVal) {
          this.write6BitRegister(merged, i, val);
        }
      }
    }

    this.store.set(destkey, { value: this.hllEncode(merged), type: 'hyperloglog', expiresAt: null });
  }

  // === JSON operations ===

  async jsonSet(key: string, path: string, value: string, nx?: boolean, xx?: boolean): Promise<string | null> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);

    let parsedValue: any;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      throw new Error('ERR invalid JSON');
    }

    if (path === '$' || path === '') {
      if (nx && this.store.has(key)) return null;
      if (xx && !this.store.has(key)) return null;
      this.store.set(key, { value: JSON.stringify(parsedValue), type: 'json', expiresAt: this.store.get(key)?.expiresAt ?? null });
      return 'OK';
    }

    // Non-root path
    const entry = this.store.get(key);
    if (!entry) {
      if (xx) return null;
      // Can't set a sub-path on non-existent key — need root object
      this.store.set(key, { value: JSON.stringify(parsedValue), type: 'json', expiresAt: null });
      return 'OK';
    }

    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, path);
    if (resolved.length === 0) {
      if (xx) return null;
      return null;
    }
    if (nx && resolved.length > 0) return null;

    for (const r of resolved) {
      if (r.parent !== null) {
        if (typeof r.key === 'number') {
          r.parent[r.key] = parsedValue;
        } else {
          r.parent[r.key] = parsedValue;
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return 'OK';
  }

  async jsonGet(key: string, paths?: string[]): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    const root = JSON.parse(entry.value);

    if (!paths || paths.length === 0) {
      return entry.value;
    }

    if (paths.length === 1) {
      const resolved = this.jsonResolvePath(root, paths[0]);
      if (resolved.length === 0) return null;
      return JSON.stringify(resolved[0].value);
    }

    // Multiple paths: return as object mapping paths to values
    const result: Record<string, any> = {};
    for (const p of paths) {
      const resolved = this.jsonResolvePath(root, p);
      if (resolved.length === 0) {
        result[p] = null;
      } else {
        result[p] = resolved[0].value;
      }
    }
    return JSON.stringify(result);
  }

  async jsonDel(key: string, path?: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    if (!path || path === '$') {
      this.store.delete(key);
      return 1;
    }

    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, path);
    if (resolved.length === 0) return 0;

    let count = 0;
    // Delete in reverse order to handle nested paths
    for (let i = resolved.length - 1; i >= 0; i--) {
      const r = resolved[i];
      if (r.parent !== null) {
        if (Array.isArray(r.parent)) {
          r.parent.splice(r.key as number, 1);
        } else {
          delete r.parent[r.key as string];
        }
        count++;
      }
    }

    if (count > 0) {
      this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    }
    return count;
  }

  async jsonType(key: string, path?: string): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    const root = JSON.parse(entry.value);
    if (!path || path === '$') {
      return this.jsonTypeOf(root);
    }

    const resolved = this.jsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    return this.jsonTypeOf(resolved[0].value);
  }

  async jsonStrlen(key: string, path?: string): Promise<number | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';
    const resolved = this.jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    if (resolved.length === 1) {
      if (typeof resolved[0].value === 'string') return resolved[0].value.length;
      return null;
    }
    // Multiple matches shouldn't happen with simple paths
    return null;
  }

  async jsonStrappend(key: string, path: string, value: string): Promise<number | null> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) throw new Error('ERR key not found');

    let root = JSON.parse(entry.value);
    let appendString: string;
    try {
      appendString = JSON.parse(value);
    } catch {
      throw new Error('ERR invalid JSON');
    }
    if (typeof appendString !== 'string') throw new Error('ERR value is not a string');

    const resolved = this.jsonResolvePath(root, path);
    if (resolved.length === 0) return null;

    for (const r of resolved) {
      if (typeof r.value === 'string') {
        if (r.parent !== null) {
          r.parent[r.key] = r.value + appendString;
        } else {
          root = root + appendString;
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    const newResolved = this.jsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'string') {
      return newResolved[0].value.length;
    }
    return null;
  }

  async jsonObjkeys(key: string, path?: string): Promise<string[] | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';
    const resolved = this.jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    const val = resolved[0].value;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val);
    }
    return null;
  }

  async jsonObjlen(key: string, path?: string): Promise<number | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';
    const resolved = this.jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    const val = resolved[0].value;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val).length;
    }
    return null;
  }

  async jsonArrappend(key: string, path: string, values: string[]): Promise<(number | null)[]> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) throw new Error('ERR key not found');

    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, path);
    const results: (number | null)[] = [];

    const parsedValues: any[] = values.map(v => {
      try { return JSON.parse(v); } catch { return v; }
    });

    for (const r of resolved) {
      if (Array.isArray(r.value)) {
        r.value.push(...parsedValues);
        if (r.parent !== null) {
          r.parent[r.key] = r.value;
        }
        results.push(r.value.length);
      } else {
        results.push(null);
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return results;
  }

  async jsonArrpop(key: string, path?: string, index?: number): Promise<string | null> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    const effectivePath = path || '$';
    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    const r = resolved[0];
    if (!Array.isArray(r.value)) return null;

    const arr = r.value;
    let idx = index ?? -1;
    if (idx < 0) idx = arr.length + idx;
    if (idx < 0 || idx >= arr.length) return null;

    const popped = arr.splice(idx, 1)[0];
    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return JSON.stringify(popped);
  }

  async jsonArrlen(key: string, path?: string): Promise<number | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';
    const resolved = this.jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    const val = resolved[0].value;
    if (Array.isArray(val)) return val.length;
    return null;
  }

  async jsonArrindex(key: string, path: string, value: string, start?: number, stop?: number): Promise<number | null> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    if (!Array.isArray(resolved[0].value)) return null;

    let searchValue: any;
    try { searchValue = JSON.parse(value); } catch { searchValue = value; }

    const arr = resolved[0].value;
    const s = start ?? 0;
    const effectiveStop = stop ?? 0;

    for (let i = s; i < arr.length; i++) {
      if (effectiveStop > 0 && i > effectiveStop) break;
      if (JSON.stringify(arr[i]) === JSON.stringify(searchValue)) {
        return i;
      }
    }
    return -1;
  }

  async jsonArrinsert(key: string, path: string, index: number, values: string[]): Promise<(number | null)[]> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) throw new Error('ERR key not found');

    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, path);
    const results: (number | null)[] = [];

    const parsedValues: any[] = values.map(v => {
      try { return JSON.parse(v); } catch { return v; }
    });

    for (const r of resolved) {
      if (Array.isArray(r.value)) {
        r.value.splice(index, 0, ...parsedValues);
        results.push(r.value.length);
      } else {
        results.push(null);
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return results;
  }

  async jsonArrtrim(key: string, path: string, start: number, stop: number): Promise<number | null> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, path);
    if (resolved.length === 0) return null;

    const r = resolved[0];
    if (!Array.isArray(r.value)) return null;

    let s = start;
    let e = stop;
    if (s < 0) s = r.value.length + s;
    if (e < 0) e = r.value.length + e;
    if (s < 0) s = 0;
    if (e >= r.value.length) e = r.value.length - 1;
    if (s > e) {
      r.value.length = 0;
    } else {
      r.value.splice(0, s);
      r.value.splice(e - s + 1);
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return r.value.length;
  }

  async jsonNumincrby(key: string, path: string, increment: number): Promise<string | null> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, path);
    if (resolved.length === 0) return null;

    for (const r of resolved) {
      if (typeof r.value === 'number') {
        const newVal = r.value + increment;
        if (r.parent !== null) {
          r.parent[r.key] = newVal;
        } else {
          root = newVal;
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    const newResolved = this.jsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'number') {
      return String(newResolved[0].value);
    }
    return null;
  }

  async jsonNummultby(key: string, path: string, multiplier: number): Promise<string | null> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, path);
    if (resolved.length === 0) return null;

    for (const r of resolved) {
      if (typeof r.value === 'number') {
        const newVal = r.value * multiplier;
        if (r.parent !== null) {
          r.parent[r.key] = newVal;
        } else {
          root = newVal;
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    const newResolved = this.jsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'number') {
      return String(newResolved[0].value);
    }
    return null;
  }

  async jsonMget(keys: string[], path: string): Promise<(string | null)[]> {
    const results: (string | null)[] = [];
    for (const key of keys) {
      this.evictIfExpired(key);
      const entry = this.store.get(key);
      if (!entry || entry.type !== 'json') {
        results.push(null);
        continue;
      }
      const root = JSON.parse(entry.value);
      const resolved = this.jsonResolvePath(root, path);
      if (resolved.length === 0) {
        results.push(null);
      } else {
        results.push(JSON.stringify(resolved[0].value));
      }
    }
    return results;
  }

  async jsonMset(pairs: Array<{ key: string; path: string; value: string }>): Promise<void> {
    for (const { key, path, value } of pairs) {
      await this.jsonSet(key, path, value);
    }
  }

  async jsonToggle(key: string, path?: string): Promise<string | null> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    const effectivePath = path || '$';
    let root = JSON.parse(entry.value);
    const resolved = this.jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    let result: string | null = null;
    for (const r of resolved) {
      if (typeof r.value === 'boolean') {
        const newVal = !r.value;
        if (r.parent !== null) {
          r.parent[r.key] = newVal;
        } else {
          root = newVal;
        }
        result = String(newVal);
      }
    }

    if (result !== null) {
      this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    }
    return result;
  }

  async jsonClear(key: string, path?: string): Promise<number> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return 0;

    const effectivePath = path || '$';
    let root = JSON.parse(entry.value);
    if (effectivePath === '$' || effectivePath === '') {
      // Clear root
      if (Array.isArray(root)) {
        root = [];
      } else if (typeof root === 'object' && root !== null) {
        root = {};
      } else if (typeof root === 'string') {
        root = '';
      } else if (typeof root === 'number') {
        root = 0;
      }
      this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
      return 1;
    }

    const resolved = this.jsonResolvePath(root, effectivePath);
    let count = 0;
    for (const r of resolved) {
      if (Array.isArray(r.value)) {
        r.parent[r.key] = [];
        count++;
      } else if (typeof r.value === 'object' && r.value !== null) {
        r.parent[r.key] = {};
        count++;
      } else if (typeof r.value === 'string') {
        r.parent[r.key] = '';
        count++;
      } else if (typeof r.value === 'number') {
        r.parent[r.key] = 0;
        count++;
      }
    }

    if (count > 0) {
      this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    }
    return count;
  }

  async jsonDebugMemory(key: string, path?: string): Promise<number | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';

    if (effectivePath === '$' || effectivePath === '') {
      return entry.value.length;
    }

    const resolved = this.jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    return JSON.stringify(resolved[0].value).length;
  }

  async jsonResp(key: string, path?: string): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.type !== 'json') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';

    let val: any;
    if (effectivePath === '$' || effectivePath === '') {
      val = root;
    } else {
      const resolved = this.jsonResolvePath(root, effectivePath);
      if (resolved.length === 0) return null;
      val = resolved[0].value;
    }

    const serializeResp = (v: any): string => {
      if (v === null) return 'null';
      if (typeof v === 'boolean') return v ? '1' : '0';
      if (typeof v === 'number') {
        if (Number.isInteger(v)) return `:${v}`;
        return `$${v}`;
      }
      if (typeof v === 'string') return `$${v.length}\n${v}`;
      if (Array.isArray(v)) {
        return `*${v.length}\n${v.map(serializeResp).join('\n')}`;
      }
      if (typeof v === 'object') {
        const keys = Object.keys(v);
        return `*${keys.length * 2}\n${keys.flatMap(k => [serializeResp(k), serializeResp(v[k])]).join('\n')}`;
      }
      return String(v);
    };

    return serializeResp(val);
  }

  async jsonMerge(key: string, path: string, value: string): Promise<void> {
    this.evictIfExpired(key);
    this.ensureJsonTypeOrThrow(key);

    let parsedValue: any;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      throw new Error('ERR invalid JSON');
    }

    const entry = this.store.get(key);
    if (!entry) {
      this.store.set(key, { value: JSON.stringify(parsedValue), type: 'json', expiresAt: null });
      return;
    }

    let root = JSON.parse(entry.value);

    if (path === '$' || path === '') {
      root = this.deepMerge(root, parsedValue);
    } else {
      const resolved = this.jsonResolvePath(root, path);
      for (const r of resolved) {
        if (r.parent !== null) {
          r.parent[r.key] = this.deepMerge(r.value, parsedValue);
        } else {
          root = this.deepMerge(root, parsedValue);
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
  }

  private deepMerge(target: any, source: any): any {
    if (source === null) return null;
    if (typeof source !== 'object' || Array.isArray(source)) return source;
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return source;
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] === null) {
        delete result[key];
      } else if (typeof source[key] === 'object' && !Array.isArray(source[key]) && typeof result[key] === 'object' && !Array.isArray(result[key])) {
        result[key] = this.deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  // === Server / Persistence ===

  async save(): Promise<void> {
    // No-op for in-memory storage
  }

  async info(section?: string): Promise<string> {
    const sections: Record<string, string> = {};

    // Server section
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    sections['server'] =
      '# Server\r\n' +
      'redis_version:7.0.0\r\n' +
      'redis_mode:standalone\r\n' +
      'os:Linux\r\n' +
      'tcp_port:6379\r\n' +
      'uptime_in_seconds:' + uptime + '\r\n';

    // Clients section
    sections['clients'] =
      '# Clients\r\n' +
      'connected_clients:0\r\n';

    // Memory section — estimate total bytes of all stored data
    let usedMemory = 0;
    for (const [key, entry] of this.store) {
      usedMemory += key.length + entry.value.length;
    }
    for (const [key, fields] of this.hashStore) {
      usedMemory += key.length;
      for (const [field, fentry] of fields) {
        usedMemory += field.length + fentry.value.length;
      }
    }
    for (const [key, list] of this.listStore) {
      usedMemory += key.length;
      for (const val of list) {
        usedMemory += val.length;
      }
    }
    for (const [key, set] of this.setStore) {
      usedMemory += key.length;
      for (const member of set) {
        usedMemory += member.length;
      }
    }
    for (const [key, zset] of this.zsetStore) {
      usedMemory += key.length;
      for (const [member] of zset) {
        usedMemory += member.length;
      }
    }
    const usedMemoryHuman = formatMemoryHuman(usedMemory);
    sections['memory'] =
      '# Memory\r\n' +
      'used_memory:' + usedMemory + '\r\n' +
      'used_memory_human:' + usedMemoryHuman + '\r\n';

    // Persistence section
    sections['persistence'] =
      '# Persistence\r\n' +
      'loading:0\r\n' +
      'rdb_last_save_time:0\r\n';

    // Keyspace section
    sections['keyspace'] =
      '# Keyspace\r\n' +
      'db0:keys=' + this.store.size + ',expires=0\r\n';

    if (section && section !== 'all') {
      return sections[section] ?? '';
    }
    // Return all sections
    return sections['server'] + sections['clients'] + sections['memory'] + sections['persistence'] + sections['keyspace'];
  }

  async getLastSaveTime(): Promise<number> {
    return 0;
  }
}