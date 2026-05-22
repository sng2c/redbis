// @ts-nocheck
import { assertType } from '../type-check';
import type { InMemoryStorage } from './core';

export const hashMethods = {
_ensureHashTypeOrThrow(key: string): void {
    assertType(this.store.get(key)?.type, 'hash');
  },

_evictExpiredHashFields(key: string): void {
    const fields = this.hashStore.get(key);
    if (!fields) return;
    const now = Date.now();
    for (const [f, e] of fields) {
      if (e.expiresAt !== null && now >= e.expiresAt) {
        fields.delete(f);
      }
    }
  },

_cleanupHashIfEmpty(key: string): void {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'hash') return;
    const fields = this.hashStore.get(key);
    if (!fields || fields.size === 0) {
      this.hashStore.delete(key);
      this.store.delete(key);
    }
  },

_hashGlobToRegex(pattern: string): RegExp {
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
  },

async hset(key: string, pairs: Array<{ field: string; value: string }>): Promise<number> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._ensureHashTypeOrThrow(key);
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
  },

async hget(key: string, field: string): Promise<string | null> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return null;
    this._ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return null;
    const entry = fields.get(field);
    return entry?.value ?? null;
  },

async hdel(key: string, fields: string[]): Promise<number> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    if (!this.store.has(key)) return 0;
    this._ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return 0;
    let deleted = 0;
    for (const field of fields) {
      if (hashFields.delete(field)) deleted++;
    }
    this._cleanupHashIfEmpty(key);
    return deleted;
  },

async hgetall(key: string): Promise<Array<{ field: string; value: string }>> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return [];
    this._ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return [];
    const result: Array<{ field: string; value: string }> = [];
    for (const [field, entry] of fields) {
      result.push({ field, value: entry.value });
    }
    return result;
  },

async hkeys(key: string): Promise<string[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return [];
    this._ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return [];
    return Array.from(fields.keys());
  },

async hvals(key: string): Promise<string[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return [];
    this._ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return [];
    return Array.from(fields.values()).map(e => e.value);
  },

async hlen(key: string): Promise<number> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return 0;
    this._ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return 0;
    return fields.size;
  },

async hexists(key: string, field: string): Promise<boolean> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return false;
    this._ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return false;
    return fields.has(field);
  },

async hsetnx(key: string, field: string, value: string): Promise<boolean> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._ensureHashTypeOrThrow(key);
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
  },

async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => null);
    this._ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => null);
    return fields.map(f => {
      const entry = hashFields.get(f);
      return entry?.value ?? null;
    });
  },

async hincrby(key: string, field: string, delta: number): Promise<number> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._ensureHashTypeOrThrow(key);
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
  },

async hincrbyfloat(key: string, field: string, delta: number): Promise<string> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._ensureHashTypeOrThrow(key);
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
  },

async hrandfield(key: string, count: number): Promise<string[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return [];
    this._ensureHashTypeOrThrow(key);
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
  },

async hscan(cursor: number, key: string, pattern?: string, count?: number): Promise<{ cursor: number; items: Array<{ field: string; value: string }> }> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return { cursor: 0, items: [] };
    this._ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return { cursor: 0, items: [] };
    const effectiveCount = count ?? 10;
    const allEntries = Array.from(fields.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const regex = pattern ? this._hashGlobToRegex(pattern) : null;
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
  },

async hstrlen(key: string, field: string): Promise<number> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return 0;
    this._ensureHashTypeOrThrow(key);
    const fields = this.hashStore.get(key);
    if (!fields) return 0;
    const entry = fields.get(field);
    return entry?.value.length ?? 0;
  },

async hgetdel(key: string, fields: string[]): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    if (!this.store.has(key)) return fields.map(() => null);
    this._ensureHashTypeOrThrow(key);
    const hashFields = this.hashStore.get(key);
    if (!hashFields) return fields.map(() => null);
    const result: (string | null)[] = [];
    for (const field of fields) {
      const entry = hashFields.get(field);
      result.push(entry?.value ?? null);
      hashFields.delete(field);
    }
    this._cleanupHashIfEmpty(key);
    return result;
  },

async hgetex(key: string, fields: string[], options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    if (!this.store.has(key)) return fields.map(() => null);
    this._ensureHashTypeOrThrow(key);
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
  },

async hsetex(key: string, pairs: Array<{ field: string; value: string }>, options?: { ex?: number; px?: number; exat?: number; pxat?: number; keepttl?: boolean }): Promise<number> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._ensureHashTypeOrThrow(key);
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
  },

async hexpire(key: string, fields: string[], seconds: number): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => 2);
    this._ensureHashTypeOrThrow(key);
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
  },

async hexpireat(key: string, fields: string[], timestamp: number): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => 2);
    this._ensureHashTypeOrThrow(key);
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
  },

async hpexpire(key: string, fields: string[], milliseconds: number): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => 2);
    this._ensureHashTypeOrThrow(key);
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
  },

async hpexpireat(key: string, fields: string[], msTimestamp: number): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => 2);
    this._ensureHashTypeOrThrow(key);
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
  },

async hexpiretime(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this._ensureHashTypeOrThrow(key);
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
  },

async hpexpiretime(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this._ensureHashTypeOrThrow(key);
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
  },

async hpersist(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this._ensureHashTypeOrThrow(key);
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
  },

async httl(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this._ensureHashTypeOrThrow(key);
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
          this._cleanupHashIfEmpty(key);
          results.push(0);
        } else {
          results.push(remaining);
        }
      }
    }
    return results;
  },

async hpttl(key: string, fields: string[]): Promise<number[]> {
    this.evictIfExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    if (!this.store.has(key)) return fields.map(() => -2);
    this._ensureHashTypeOrThrow(key);
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
          this._cleanupHashIfEmpty(key);
          results.push(0);
        } else {
          results.push(remaining);
        }
      }
    }
    return results;
  },

};
