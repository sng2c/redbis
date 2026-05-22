// @ts-nocheck
import { assertType, assertTypeOneOf, WRONGTYPE_ERROR } from '../type-check';
import { globToRegex } from './types';
import type { SqliteStorage } from './core';

export const hashMethods = {
_evictExpiredHashFields(key: string): void {
    this.db.prepare(
      "DELETE FROM hash_store WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?"
    ).run(key, Date.now());
  },

_cleanupHashIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow || typeRow.type !== 'hash') return;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM hash_store WHERE key = ?').get(key) as { cnt: number };
    if (row.cnt === 0) {
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
  },

_ensureHashKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    assertType(row?.type, 'hash');
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'hash', NULL)").run(key);
    }
  },

async hset(key: string, pairs: Array<{ field: string; value: string }>): Promise<number> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    assertType(row?.type, 'hash');
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'hash', NULL)").run(key);
    }
    let newCount = 0;
    for (const { field, value } of pairs) {
      const existing = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
      if (!existing) newCount++;
      this.db.prepare(
        'INSERT OR REPLACE INTO hash_store (key, field, value, expires_at) VALUES (?, ?, ?, ?)'
      ).run(key, field, value, existing ? (this.db.prepare('SELECT expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { expires_at: number | null }).expires_at : null);
    }
    return newCount;
  },

async hget(key: string, field: string): Promise<string | null> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return null;
    assertType(row.type, 'hash');
    const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string } | undefined;
    return fieldRow?.value ?? null;
  },

async hdel(key: string, fields: string[]): Promise<number> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return 0;
    assertType(row.type, 'hash');
    let deleted = 0;
    for (const field of fields) {
      const result = this.db.prepare('DELETE FROM hash_store WHERE key = ? AND field = ?').run(key, field);
      deleted += result.changes;
    }
    this._cleanupHashIfEmpty(key);
    return deleted;
  },

async hgetall(key: string): Promise<Array<{ field: string; value: string }>> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return [];
    assertType(row.type, 'hash');
    const rows = this.db.prepare('SELECT field, value FROM hash_store WHERE key = ? ORDER BY field').all(key) as { field: string; value: string }[];
    return rows.map(r => ({ field: r.field, value: r.value }));
  },

async hkeys(key: string): Promise<string[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return [];
    assertType(row.type, 'hash');
    const rows = this.db.prepare('SELECT field FROM hash_store WHERE key = ? ORDER BY field').all(key) as { field: string }[];
    return rows.map(r => r.field);
  },

async hvals(key: string): Promise<string[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return [];
    assertType(row.type, 'hash');
    const rows = this.db.prepare('SELECT value FROM hash_store WHERE key = ?').all(key) as { value: string }[];
    return rows.map(r => r.value);
  },

async hlen(key: string): Promise<number> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return 0;
    assertType(row.type, 'hash');
    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM hash_store WHERE key = ?').get(key) as { cnt: number };
    return cntRow.cnt;
  },

async hexists(key: string, field: string): Promise<boolean> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return false;
    assertType(row.type, 'hash');
    const fieldRow = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
    return !!fieldRow;
  },

async hsetnx(key: string, field: string, value: string): Promise<boolean> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    assertType(row?.type, 'hash');
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'hash', NULL)").run(key);
    }
    const existing = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
    if (existing) return false;
    this.db.prepare(
      'INSERT OR REPLACE INTO hash_store (key, field, value, expires_at) VALUES (?, ?, ?, NULL)'
    ).run(key, field, value);
    return true;
  },

async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => null);
    assertType(row.type, 'hash');
    return fields.map(f => {
      const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, f) as { value: string } | undefined;
      return fieldRow?.value ?? null;
    });
  },

async hincrby(key: string, field: string, delta: number): Promise<number> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    assertType(row?.type, 'hash');
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'hash', NULL)").run(key);
    }
    const fieldRow = this.db.prepare('SELECT value, expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string; expires_at: number | null } | undefined;
    let current = 0;
    let existingExpiresAt: number | null = null;
    if (fieldRow) {
      const parsed = parseInt(fieldRow.value, 10);
      if (isNaN(parsed) || !Number.isInteger(parsed)) {
        throw new Error('ERR value is not an integer or out of range');
      }
      current = parsed;
      existingExpiresAt = fieldRow.expires_at;
    }
    const result = current + delta;
    this.db.prepare(
      'INSERT OR REPLACE INTO hash_store (key, field, value, expires_at) VALUES (?, ?, ?, ?)'
    ).run(key, field, String(result), existingExpiresAt);
    return result;
  },

async hincrbyfloat(key: string, field: string, delta: number): Promise<string> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    assertType(row?.type, 'hash');
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'hash', NULL)").run(key);
    }
    const fieldRow = this.db.prepare('SELECT value, expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string; expires_at: number | null } | undefined;
    let current = 0;
    let existingExpiresAt: number | null = null;
    if (fieldRow) {
      const parsed = parseFloat(fieldRow.value);
      if (isNaN(parsed)) {
        throw new Error('ERR value is not a valid float');
      }
      current = parsed;
      existingExpiresAt = fieldRow.expires_at;
    }
    const result = current + delta;
    if (isNaN(result)) {
      throw new Error('ERR value is not a valid float');
    }
    let resultStr = parseFloat(result.toPrecision(15)).toString();
    this.db.prepare(
      'INSERT OR REPLACE INTO hash_store (key, field, value, expires_at) VALUES (?, ?, ?, ?)'
    ).run(key, field, resultStr, existingExpiresAt);
    return resultStr;
  },

async hrandfield(key: string, count: number): Promise<string[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return [];
    assertType(row.type, 'hash');
    if (count === 0) return [];
    if (count > 0) {
      const rows = this.db.prepare('SELECT field FROM hash_store WHERE key = ? ORDER BY RANDOM() LIMIT ?').all(key, count) as { field: string }[];
      return rows.map(r => r.field);
    } else {
      const allRows = this.db.prepare('SELECT field FROM hash_store WHERE key = ?').all(key) as { field: string }[];
      if (allRows.length === 0) return [];
      const result: string[] = [];
      for (let i = 0; i < Math.abs(count); i++) {
        result.push(allRows[Math.floor(Math.random() * allRows.length)].field);
      }
      return result;
    }
  },

async hscan(cursor: number, key: string, pattern?: string, count?: number): Promise<{ cursor: number; items: Array<{ field: string; value: string }> }> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return { cursor: 0, items: [] };
    assertType(row.type, 'hash');
    const effectiveCount = count ?? 10;
    const allRows = this.db.prepare('SELECT field, value FROM hash_store WHERE key = ? ORDER BY field').all(key) as { field: string; value: string }[];
    const regex = pattern ? globToRegex(pattern) : null;
    const matchedItems: Array<{ field: string; value: string }> = [];
    let idx = cursor;
    while (idx < allRows.length && matchedItems.length < effectiveCount) {
      if (!regex || regex.test(allRows[idx].field)) {
        matchedItems.push({ field: allRows[idx].field, value: allRows[idx].value });
      }
      idx++;
    }
    const nextCursor = idx >= allRows.length ? 0 : idx;
    return { cursor: nextCursor, items: matchedItems };
  },

async hstrlen(key: string, field: string): Promise<number> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return 0;
    assertType(row.type, 'hash');
    const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string } | undefined;
    return fieldRow ? fieldRow.value.length : 0;
  },

async hgetdel(key: string, fields: string[]): Promise<(string | null)[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => null);
    assertType(row.type, 'hash');
    const tx = this.db.transaction(() => {
      const result: (string | null)[] = [];
      for (const field of fields) {
        const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string } | undefined;
        result.push(fieldRow?.value ?? null);
        this.db.prepare('DELETE FROM hash_store WHERE key = ? AND field = ?').run(key, field);
      }
      this._cleanupHashIfEmpty(key);
      return result;
    });
    return tx();
  },

async hgetex(key: string, fields: string[], options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<(string | null)[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => null);
    assertType(row.type, 'hash');
    const result: (string | null)[] = [];
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string } | undefined;
      result.push(fieldRow?.value ?? null);
      if (fieldRow && options) {
        if (options.persist) {
          this.db.prepare('UPDATE hash_store SET expires_at = NULL WHERE key = ? AND field = ?').run(key, field);
        } else if (options.px !== undefined) {
          this.db.prepare('UPDATE hash_store SET expires_at = ? WHERE key = ? AND field = ?').run(Date.now() + options.px, key, field);
        } else if (options.ex !== undefined) {
          this.db.prepare('UPDATE hash_store SET expires_at = ? WHERE key = ? AND field = ?').run(Date.now() + options.ex * 1000, key, field);
        } else if (options.pxat !== undefined) {
          this.db.prepare('UPDATE hash_store SET expires_at = ? WHERE key = ? AND field = ?').run(options.pxat, key, field);
        } else if (options.exat !== undefined) {
          this.db.prepare('UPDATE hash_store SET expires_at = ? WHERE key = ? AND field = ?').run(options.exat * 1000, key, field);
        }
      }
    }
    return result;
  },

async hsetex(key: string, pairs: Array<{ field: string; value: string }>, options?: { ex?: number; px?: number; exat?: number; pxat?: number; keepttl?: boolean }): Promise<number> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    assertType(row?.type, 'hash');
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'hash', NULL)").run(key);
    }

    let calculatedExpiresAt: number | null = null;
    if (options) {
      if (options.ex !== undefined) calculatedExpiresAt = Date.now() + options.ex * 1000;
      else if (options.px !== undefined) calculatedExpiresAt = Date.now() + options.px;
      else if (options.exat !== undefined) calculatedExpiresAt = options.exat * 1000;
      else if (options.pxat !== undefined) calculatedExpiresAt = options.pxat;
    }

    let newCount = 0;
    for (const { field, value } of pairs) {
      const existing = this.db.prepare('SELECT expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { expires_at: number | null } | undefined;
      if (!existing) {
        newCount++;
      }
      let expiresAt: number | null;
      if (existing && options?.keepttl) {
        expiresAt = existing.expires_at;
      } else {
        expiresAt = calculatedExpiresAt;
      }
      this.db.prepare(
        'INSERT OR REPLACE INTO hash_store (key, field, value, expires_at) VALUES (?, ?, ?, ?)'
      ).run(key, field, value, expiresAt);
    }
    return newCount;
  },

async hexpire(key: string, fields: string[], seconds: number): Promise<number[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => 2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    const expiresAt = Date.now() + seconds * 1000;
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
      if (!fieldRow) {
        results.push(0);
      } else {
        this.db.prepare('UPDATE hash_store SET expires_at = ? WHERE key = ? AND field = ?').run(expiresAt, key, field);
        results.push(1);
      }
    }
    return results;
  },

async hexpireat(key: string, fields: string[], timestamp: number): Promise<number[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => 2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    const expiresAt = timestamp * 1000;
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
      if (!fieldRow) {
        results.push(0);
      } else {
        this.db.prepare('UPDATE hash_store SET expires_at = ? WHERE key = ? AND field = ?').run(expiresAt, key, field);
        results.push(1);
      }
    }
    return results;
  },

async hpexpire(key: string, fields: string[], milliseconds: number): Promise<number[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => 2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    const expiresAt = Date.now() + milliseconds;
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
      if (!fieldRow) {
        results.push(0);
      } else {
        this.db.prepare('UPDATE hash_store SET expires_at = ? WHERE key = ? AND field = ?').run(expiresAt, key, field);
        results.push(1);
      }
    }
    return results;
  },

async hpexpireat(key: string, fields: string[], msTimestamp: number): Promise<number[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => 2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
      if (!fieldRow) {
        results.push(0);
      } else {
        this.db.prepare('UPDATE hash_store SET expires_at = ? WHERE key = ? AND field = ?').run(msTimestamp, key, field);
        results.push(1);
      }
    }
    return results;
  },

async hexpiretime(key: string, fields: string[]): Promise<number[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { expires_at: number | null } | undefined;
      if (!fieldRow) {
        results.push(0);
      } else if (fieldRow.expires_at === null) {
        results.push(-1);
      } else {
        results.push(Math.floor(fieldRow.expires_at / 1000));
      }
    }
    return results;
  },

async hpexpiretime(key: string, fields: string[]): Promise<number[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { expires_at: number | null } | undefined;
      if (!fieldRow) {
        results.push(0);
      } else if (fieldRow.expires_at === null) {
        results.push(-1);
      } else {
        results.push(fieldRow.expires_at);
      }
    }
    return results;
  },

async hpersist(key: string, fields: string[]): Promise<number[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { expires_at: number | null } | undefined;
      if (!fieldRow) {
        results.push(0);
      } else if (fieldRow.expires_at === null) {
        results.push(-1);
      } else {
        this.db.prepare('UPDATE hash_store SET expires_at = NULL WHERE key = ? AND field = ?').run(key, field);
        results.push(1);
      }
    }
    return results;
  },

async httl(key: string, fields: string[]): Promise<number[]> {
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    const now = Date.now();
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { expires_at: number | null } | undefined;
      if (!fieldRow) {
        results.push(0);
      } else if (fieldRow.expires_at === null) {
        results.push(-1);
      } else {
        const remaining = Math.ceil((fieldRow.expires_at - now) / 1000);
        if (remaining <= 0) {
          this.db.prepare('DELETE FROM hash_store WHERE key = ? AND field = ?').run(key, field);
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
    this.evictExpired(key);
    this._evictExpiredHashFields(key);
    this._cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    assertType(row.type, 'hash');
    const results: number[] = [];
    const now = Date.now();
    for (const field of fields) {
      const fieldRow = this.db.prepare('SELECT expires_at FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { expires_at: number | null } | undefined;
      if (!fieldRow) {
        results.push(0);
      } else if (fieldRow.expires_at === null) {
        results.push(-1);
      } else {
        const remaining = fieldRow.expires_at - now;
        if (remaining <= 0) {
          this.db.prepare('DELETE FROM hash_store WHERE key = ? AND field = ?').run(key, field);
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
