import { IStorage } from './interface';

type StoreEntry = { value: string; type: string; expiresAt: number | null };

export class InMemoryStorage implements IStorage {
  private store: Map<string, StoreEntry> = new Map();
  private hashStore: Map<string, Map<string, { value: string; expiresAt: number | null }>> = new Map();
  private listStore: Map<string, string[]> = new Map();
  private setStore: Map<string, Set<string>> = new Map();

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
}