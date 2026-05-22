import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { IStorage, StorageConfig } from './interface';

function globToRegex(pattern: string): RegExp {
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

export class SqliteStorage implements IStorage {
  private db: Database.Database;

  constructor(config: StorageConfig = { path: ':memory:' }) {
    if (config.path !== ':memory:') {
      mkdirSync(dirname(config.path), { recursive: true });
    }
    this.db = new Database(config.path);
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
    ).run();
    this.migrate();
  }

  private migrate(): void {
    try {
      this.db.exec("ALTER TABLE kv_store ADD COLUMN type TEXT DEFAULT 'string'");
    } catch (e) {
      // Column already exists — ignore
    }
    try {
      this.db.exec('ALTER TABLE kv_store ADD COLUMN expires_at INTEGER DEFAULT NULL');
    } catch (e) {
      // Column already exists — ignore
    }
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS hash_store (key TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER DEFAULT NULL, PRIMARY KEY (key, field))'
    ).run();
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS list_store (key TEXT NOT NULL, seq REAL NOT NULL, value TEXT NOT NULL, PRIMARY KEY (key, seq))'
    ).run();
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS set_store (key TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY (key, member))'
    ).run();
  }

  private evictExpired(key: string): void {
    const result = this.db.prepare(
      "DELETE FROM kv_store WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?"
    ).run(key, Date.now());
    if (result.changes > 0) {
      this.db.prepare('DELETE FROM hash_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(key);
    }
  }

  private evictAllExpired(): void {
    this.db.prepare(
      "DELETE FROM hash_store WHERE key IN (SELECT key FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?)"
    ).run(Date.now());
    this.db.prepare(
      "DELETE FROM list_store WHERE key IN (SELECT key FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?)"
    ).run(Date.now());
    this.db.prepare(
      "DELETE FROM set_store WHERE key IN (SELECT key FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?)"
    ).run(Date.now());
    this.db.prepare(
      "DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?"
    ).run(Date.now());
  }

  // === Existing methods ===

  async get(key: string): Promise<string | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.evictExpired(key);
    this.db.prepare(
      "INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)"
    ).run(key, value);
  }

  async delete(key: string): Promise<boolean> {
    this.evictExpired(key);
    const result = this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM hash_store WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM set_store WHERE key = ?').run(key);
    return result.changes > 0;
  }

  async keys(pattern: string): Promise<string[]> {
    this.evictAllExpired();
    const rows = this.db.prepare('SELECT key FROM kv_store').all() as { key: string }[];
    const regex = globToRegex(pattern);
    return rows.filter(row => regex.test(row.key)).map(row => row.key).sort();
  }

  async flush(): Promise<void> {
    this.db.prepare('DELETE FROM kv_store').run();
    this.db.prepare('DELETE FROM hash_store').run();
    this.db.prepare('DELETE FROM list_store').run();
    this.db.prepare('DELETE FROM set_store').run();
  }

  // === Multi-key ===

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    for (const key of keys) this.evictExpired(key);
    const placeholders = keys.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT key, value FROM kv_store WHERE key IN (${placeholders})`
    ).all(...keys) as { key: string; value: string }[];
    const map = new Map(rows.map(r => [r.key, r.value] as [string, string]));
    return keys.map(k => map.get(k) ?? null);
  }

  async mset(pairs: Array<{ key: string; value: string }>): Promise<void> {
    if (pairs.length === 0) return;
    for (const p of pairs) this.evictExpired(p.key);
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)"
    );
    const tx = this.db.transaction(() => {
      for (const p of pairs) stmt.run(p.key, p.value);
    });
    tx();
  }

  async msetnx(pairs: Array<{ key: string; value: string }>): Promise<boolean> {
    if (pairs.length === 0) return true;
    for (const p of pairs) this.evictExpired(p.key);
    const placeholders = pairs.map(p => '?').join(',');
    const existing = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM kv_store WHERE key IN (${placeholders})`
    ).get(...pairs.map(p => p.key)) as { cnt: number };
    if (existing.cnt > 0) return false;
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)"
    );
    const tx = this.db.transaction(() => {
      for (const p of pairs) stmt.run(p.key, p.value);
    });
    tx();
    return true;
  }

  // === String operations ===

  async append(key: string, value: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) {
      this.db.prepare(
        "INSERT INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)"
      ).run(key, value);
      return value.length;
    }
    const newValue = row.value + value;
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(newValue, key);
    return newValue.length;
  }

  async strlen(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value.length : 0;
  }

  async getrange(key: string, start: number, end: number): Promise<string> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return '';
    const str = row.value;
    const len = str.length;
    let s = start;
    let e = end;
    if (s < 0) s = Math.max(len + s, 0);
    if (e < 0) e = Math.max(len + e, 0);
    if (s > e || s >= len) return '';
    return str.substring(s, e + 1);
  }

  async setrange(key: string, offset: number, value: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; type: string; expires_at: number | null } | undefined;

    let current: string;
    let existingType: string;
    let existingExpiresAt: number | null;

    if (!row) {
      current = '';
      existingType = 'string';
      existingExpiresAt = null;
    } else {
      current = row.value;
      existingType = row.type;
      existingExpiresAt = row.expires_at;
    }

    // Pad with null bytes if offset > current length
    if (offset > current.length) {
      current = current + '\0'.repeat(offset - current.length);
    }

    // Apply the replacement
    const before = current.substring(0, offset);
    const after = current.substring(offset + value.length);
    const newValue = before + value + after;

    this.db.prepare(
      'INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, ?, ?)'
    ).run(key, newValue, existingType, existingExpiresAt);

    return newValue.length;
  }

  async incrby(key: string, delta: number): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;

    let current: number;
    let existingExpiresAt: number | null;

    if (!row) {
      current = 0;
      existingExpiresAt = null;
    } else {
      const parsed = parseInt(row.value, 10);
      if (isNaN(parsed) || !Number.isInteger(parsed)) {
        throw new Error('ERR value is not an integer or out of range');
      }
      current = parsed;
      existingExpiresAt = row.expires_at;
    }

    const result = current + delta;
    this.db.prepare(
      'INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, \'string\', ?)'
    ).run(key, String(result), existingExpiresAt);

    return result;
  }

  async incrbyfloat(key: string, delta: number): Promise<string> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;

    let current: number;
    let existingExpiresAt: number | null;

    if (!row) {
      current = 0;
      existingExpiresAt = null;
    } else {
      const parsed = parseFloat(row.value);
      if (isNaN(parsed)) {
        throw new Error('ERR value is not a valid float');
      }
      current = parsed;
      existingExpiresAt = row.expires_at;
    }

    const result = current + delta;
    if (isNaN(result)) {
      throw new Error('ERR value is not a valid float');
    }

    let resultStr: string;
    if (Number.isInteger(result) && !delta.toString().includes('.')) {
      resultStr = String(result);
    } else {
      resultStr = parseFloat(result.toPrecision(15)).toString();
    }

    this.db.prepare(
      'INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, \'string\', ?)'
    ).run(key, resultStr, existingExpiresAt);

    return resultStr;
  }

  // === Conditional set ===

  async setnx(key: string, value: string): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (row) return false;
    this.db.prepare(
      "INSERT INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)"
    ).run(key, value);
    return true;
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    if (seconds <= 0) {
      throw new Error("ERR invalid expire time in 'SETEX' command");
    }
    this.evictExpired(key);
    const expiresAt = Date.now() + seconds * 1000;
    this.db.prepare(
      'INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, \'string\', ?)'
    ).run(key, value, expiresAt);
  }

  async psetex(key: string, milliseconds: number, value: string): Promise<void> {
    if (milliseconds <= 0) {
      throw new Error("ERR invalid expire time in 'PSETEX' command");
    }
    this.evictExpired(key);
    const expiresAt = Date.now() + milliseconds;
    this.db.prepare(
      'INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, \'string\', ?)'
    ).run(key, value, expiresAt);
  }

  async getset(key: string, value: string): Promise<string | null> {
    this.evictExpired(key);
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      const oldValue = row?.value ?? null;
      this.db.prepare(
        "INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)"
      ).run(key, value);
      return oldValue;
    });
    return tx();
  }

  async getdel(key: string): Promise<string | null> {
    this.evictExpired(key);
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      if (!row) return null;
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
      return row.value;
    });
    return tx();
  }

  async getex(key: string, options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<string | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return null;
    const value = row.value;

    if (options) {
      if (options.persist) {
        this.db.prepare('UPDATE kv_store SET expires_at = NULL WHERE key = ?').run(key);
      } else if (options.px !== undefined) {
        this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(Date.now() + options.px, key);
      } else if (options.ex !== undefined) {
        this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(Date.now() + options.ex * 1000, key);
      } else if (options.pxat !== undefined) {
        this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(options.pxat, key);
      } else if (options.exat !== undefined) {
        this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(options.exat * 1000, key);
      }
    }

    return value;
  }

  // === Key management ===

  async rename(oldKey: string, newKey: string): Promise<void> {
    this.evictExpired(oldKey);
    this.evictExpired(newKey);

    if (oldKey === newKey) return;

    const row = this.db.prepare('SELECT value, type, expires_at FROM kv_store WHERE key = ?').get(oldKey) as { value: string; type: string; expires_at: number | null } | undefined;
    if (!row) {
      throw new Error('ERR no such key');
    }

    const tx = this.db.transaction(() => {
      this.db.prepare(
        'INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, ?, ?)'
      ).run(newKey, row.value, row.type, row.expires_at);
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(oldKey);
      this.db.prepare('UPDATE hash_store SET key = ? WHERE key = ?').run(newKey, oldKey);
      this.db.prepare('UPDATE list_store SET key = ? WHERE key = ?').run(newKey, oldKey);
      this.db.prepare('UPDATE set_store SET key = ? WHERE key = ?').run(newKey, oldKey);
    });
    tx();
  }

  async renamenx(oldKey: string, newKey: string): Promise<boolean> {
    this.evictExpired(oldKey);
    this.evictExpired(newKey);

    const row = this.db.prepare('SELECT value, type, expires_at FROM kv_store WHERE key = ?').get(oldKey) as { value: string; type: string; expires_at: number | null } | undefined;
    if (!row) {
      throw new Error('ERR no such key');
    }

    if (oldKey === newKey) return true;

    const existing = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(newKey);
    if (existing) return false;

    const tx = this.db.transaction(() => {
      this.db.prepare(
        'INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, ?, ?)'
      ).run(newKey, row.value, row.type, row.expires_at);
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(oldKey);
    });
    tx();
    return true;
  }

  async type(key: string): Promise<string> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    return row?.type ?? 'none';
  }

  async dbsize(): Promise<number> {
    this.evictAllExpired();
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM kv_store').get() as { cnt: number };
    return row.cnt;
  }

  async copy(source: string, destination: string): Promise<boolean> {
    this.evictExpired(source);
    this.evictExpired(destination);

    if (source === destination) return false;

    const row = this.db.prepare('SELECT value, type, expires_at FROM kv_store WHERE key = ?').get(source) as { value: string; type: string; expires_at: number | null } | undefined;
    if (!row) return false;

    this.db.prepare(
      'INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, ?, ?)'
    ).run(destination, row.value, row.type, row.expires_at);

    if (row.type === 'hash') {
      this.db.prepare(
        'INSERT OR REPLACE INTO hash_store (key, field, value, expires_at) SELECT ?, field, value, expires_at FROM hash_store WHERE key = ?'
      ).run(destination, source);
    }
    if (row.type === 'list') {
      this.db.prepare(
        'INSERT OR REPLACE INTO list_store (key, seq, value) SELECT ?, seq, value FROM list_store WHERE key = ?'
      ).run(destination, source);
    }
    if (row.type === 'set') {
      this.db.prepare(
        'INSERT OR REPLACE INTO set_store (key, member) SELECT ?, member FROM set_store WHERE key = ?'
      ).run(destination, source);
    }

    return true;
  }

  async randomkey(): Promise<string | null> {
    this.evictAllExpired();
    const row = this.db.prepare('SELECT key FROM kv_store ORDER BY RANDOM() LIMIT 1').get() as { key: string } | undefined;
    return row?.key ?? null;
  }

  async unlink(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    for (const key of keys) this.evictExpired(key);
    const placeholders = keys.map(() => '?').join(',');
    const existing = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM kv_store WHERE key IN (${placeholders})`
    ).get(...keys) as { cnt: number };
    this.db.prepare(
      `DELETE FROM kv_store WHERE key IN (${placeholders})`
    ).run(...keys);
    this.db.prepare(
      `DELETE FROM hash_store WHERE key IN (${placeholders})`
    ).run(...keys);
    this.db.prepare(
      `DELETE FROM list_store WHERE key IN (${placeholders})`
    ).run(...keys);
    this.db.prepare(
      `DELETE FROM set_store WHERE key IN (${placeholders})`
    ).run(...keys);
    return existing.cnt;
  }

  async touch(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    for (const key of keys) this.evictExpired(key);
    const placeholders = keys.map(() => '?').join(',');
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM kv_store WHERE key IN (${placeholders})`
    ).get(...keys) as { cnt: number };
    return row.cnt;
  }

  // === Expiry ===

  async expire(key: string, seconds: number): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (!row) return false;
    this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(Date.now() + seconds * 1000, key);
    return true;
  }

  async expireat(key: string, timestamp: number): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (!row) return false;
    this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(timestamp * 1000, key);
    return true;
  }

  async pexpire(key: string, milliseconds: number): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (!row) return false;
    this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(Date.now() + milliseconds, key);
    return true;
  }

  async pexpireat(key: string, millisecondsTimestamp: number): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (!row) return false;
    this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(millisecondsTimestamp, key);
    return true;
  }

  async ttl(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as { expires_at: number | null } | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;
    const remaining = Math.ceil((row.expires_at - Date.now()) / 1000);
    if (remaining <= 0) {
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
      return -2;
    }
    return remaining;
  }

  async pttl(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as { expires_at: number | null } | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;
    const remaining = row.expires_at - Date.now();
    if (remaining <= 0) {
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
      return -2;
    }
    return remaining;
  }

  async persist(key: string): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as { expires_at: number | null } | undefined;
    if (!row) return false;
    if (row.expires_at === null) return false;
    this.db.prepare('UPDATE kv_store SET expires_at = NULL WHERE key = ?').run(key);
    return true;
  }

  async expiretime(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as { expires_at: number | null } | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;
    return Math.floor(row.expires_at / 1000);
  }

  async pexpiretime(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as { expires_at: number | null } | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;
    return row.expires_at;
  }

  // === SCAN ===

  async scan(cursor: number, pattern?: string, count?: number): Promise<{ cursor: number; keys: string[] }> {
    this.evictAllExpired();

    const effectiveCount = count ?? 10;

    // Fetch all keys with rowid, ordered by rowid
    const rows = this.db.prepare(
      'SELECT key, rowid FROM kv_store WHERE rowid > ? ORDER BY rowid'
    ).all(cursor) as { key: string; rowid: number }[];

    const regex = pattern ? globToRegex(pattern) : null;

    const matchedKeys: string[] = [];
    let lastRowId = cursor;

    for (const row of rows) {
      if (matchedKeys.length >= effectiveCount) break;
      if (!regex || regex.test(row.key)) {
        matchedKeys.push(row.key);
      }
      lastRowId = row.rowid;
    }

    // Check if there are more rows beyond what we've processed
    const remainingRows = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM kv_store WHERE rowid > ?'
    ).get(lastRowId) as { cnt: number };

    const nextCursor = remainingRows.cnt > 0 ? lastRowId : 0;

    return { cursor: nextCursor, keys: matchedKeys };
  }

  // === Hash helpers ===

  private evictExpiredHashFields(key: string): void {
    this.db.prepare(
      "DELETE FROM hash_store WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?"
    ).run(key, Date.now());
  }

  private cleanupHashIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow || typeRow.type !== 'hash') return;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM hash_store WHERE key = ?').get(key) as { cnt: number };
    if (row.cnt === 0) {
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
  }

  private ensureHashKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'hash', NULL)").run(key);
    }
  }

  // === Hash operations ===

  async hset(key: string, pairs: Array<{ field: string; value: string }>): Promise<number> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return null;
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string } | undefined;
    return fieldRow?.value ?? null;
  }

  async hdel(key: string, fields: string[]): Promise<number> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return 0;
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    let deleted = 0;
    for (const field of fields) {
      const result = this.db.prepare('DELETE FROM hash_store WHERE key = ? AND field = ?').run(key, field);
      deleted += result.changes;
    }
    this.cleanupHashIfEmpty(key);
    return deleted;
  }

  async hgetall(key: string): Promise<Array<{ field: string; value: string }>> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return [];
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const rows = this.db.prepare('SELECT field, value FROM hash_store WHERE key = ? ORDER BY field').all(key) as { field: string; value: string }[];
    return rows.map(r => ({ field: r.field, value: r.value }));
  }

  async hkeys(key: string): Promise<string[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return [];
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const rows = this.db.prepare('SELECT field FROM hash_store WHERE key = ? ORDER BY field').all(key) as { field: string }[];
    return rows.map(r => r.field);
  }

  async hvals(key: string): Promise<string[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return [];
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const rows = this.db.prepare('SELECT value FROM hash_store WHERE key = ?').all(key) as { value: string }[];
    return rows.map(r => r.value);
  }

  async hlen(key: string): Promise<number> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return 0;
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM hash_store WHERE key = ?').get(key) as { cnt: number };
    return cntRow.cnt;
  }

  async hexists(key: string, field: string): Promise<boolean> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return false;
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const fieldRow = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
    return !!fieldRow;
  }

  async hsetnx(key: string, field: string, value: string): Promise<boolean> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'hash', NULL)").run(key);
    }
    const existing = this.db.prepare('SELECT 1 FROM hash_store WHERE key = ? AND field = ?').get(key, field);
    if (existing) return false;
    this.db.prepare(
      'INSERT OR REPLACE INTO hash_store (key, field, value, expires_at) VALUES (?, ?, ?, NULL)'
    ).run(key, field, value);
    return true;
  }

  async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => null);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    return fields.map(f => {
      const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, f) as { value: string } | undefined;
      return fieldRow?.value ?? null;
    });
  }

  async hincrby(key: string, field: string, delta: number): Promise<number> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hincrbyfloat(key: string, field: string, delta: number): Promise<string> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hrandfield(key: string, count: number): Promise<string[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return [];
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hscan(cursor: number, key: string, pattern?: string, count?: number): Promise<{ cursor: number; items: Array<{ field: string; value: string }> }> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return { cursor: 0, items: [] };
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hstrlen(key: string, field: string): Promise<number> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return 0;
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string } | undefined;
    return fieldRow ? fieldRow.value.length : 0;
  }

  async hgetdel(key: string, fields: string[]): Promise<(string | null)[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => null);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const tx = this.db.transaction(() => {
      const result: (string | null)[] = [];
      for (const field of fields) {
        const fieldRow = this.db.prepare('SELECT value FROM hash_store WHERE key = ? AND field = ?').get(key, field) as { value: string } | undefined;
        result.push(fieldRow?.value ?? null);
        this.db.prepare('DELETE FROM hash_store WHERE key = ? AND field = ?').run(key, field);
      }
      this.cleanupHashIfEmpty(key);
      return result;
    });
    return tx();
  }

  async hgetex(key: string, fields: string[], options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<(string | null)[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => null);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hsetex(key: string, pairs: Array<{ field: string; value: string }>, options?: { ex?: number; px?: number; exat?: number; pxat?: number; keepttl?: boolean }): Promise<number> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hexpire(key: string, fields: string[], seconds: number): Promise<number[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => 2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hexpireat(key: string, fields: string[], timestamp: number): Promise<number[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => 2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hpexpire(key: string, fields: string[], milliseconds: number): Promise<number[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => 2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hpexpireat(key: string, fields: string[], msTimestamp: number): Promise<number[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => 2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hexpiretime(key: string, fields: string[]): Promise<number[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hpexpiretime(key: string, fields: string[]): Promise<number[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async hpersist(key: string, fields: string[]): Promise<number[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
  }

  async httl(key: string, fields: string[]): Promise<number[]> {
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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
    this.evictExpired(key);
    this.evictExpiredHashFields(key);
    this.cleanupHashIfEmpty(key);
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!row) return fields.map(() => -2);
    if (row.type !== 'hash') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
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

  private ensureListKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'list', NULL)").run(key);
    }
  }

  private ensureListTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private cleanupListIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow || typeRow.type !== 'list') return;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
    if (row.cnt === 0) {
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
    }
  }

  // === List operations ===

  async lpush(key: string, elements: string[]): Promise<number> {
    this.evictExpired(key);
    this.ensureListTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      this.ensureListKvStoreEntry(key);
      const minSeqRow = this.db.prepare('SELECT MIN(seq) as minSeq FROM list_store WHERE key = ?').get(key) as { minSeq: number | null };
      let nextSeq = minSeqRow.minSeq !== null ? minSeqRow.minSeq - 1 : 0;
      const stmt = this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)');
      for (const el of elements) {
        stmt.run(key, nextSeq, el);
        nextSeq--;
      }
      const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
      return countRow.cnt;
    });
    return tx();
  }

  async rpush(key: string, elements: string[]): Promise<number> {
    this.evictExpired(key);
    this.ensureListTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      this.ensureListKvStoreEntry(key);
      const maxSeqRow = this.db.prepare('SELECT MAX(seq) as maxSeq FROM list_store WHERE key = ?').get(key) as { maxSeq: number | null };
      let nextSeq = maxSeqRow.maxSeq !== null ? maxSeqRow.maxSeq + 1 : 1;
      const stmt = this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)');
      for (const el of elements) {
        stmt.run(key, nextSeq, el);
        nextSeq++;
      }
      const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
      return countRow.cnt;
    });
    return tx();
  }

  async lpop(key: string, count?: number): Promise<string | string[] | null> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return null;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      if (count === undefined || count === 1) {
        const row = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT 1').get(key) as { value: string } | undefined;
        if (!row) {
          this.cleanupListIfEmpty(key);
          return null;
        }
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = (SELECT seq FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT 1)').run(key, key);
        this.cleanupListIfEmpty(key);
        return row.value as string | string[] | null;
      }
      const rows = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT ?').all(key, count) as { value: string }[];
      if (rows.length === 0) {
        this.cleanupListIfEmpty(key);
        return null;
      }
      for (const row of rows) {
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND value = ? AND seq = (SELECT seq FROM list_store WHERE key = ? AND value = ? ORDER BY seq ASC LIMIT 1)').run(key, row.value, key, row.value);
      }
      this.cleanupListIfEmpty(key);
      return rows.map(r => r.value) as string | string[] | null;
    });
    const result = tx();
    if (count === undefined || count === 1) {
      return result as string | null;
    }
    return result as string[] | null;
  }

  async rpop(key: string, count?: number): Promise<string | string[] | null> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return null;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      if (count === undefined || count === 1) {
        const row = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT 1').get(key) as { value: string } | undefined;
        if (!row) {
          this.cleanupListIfEmpty(key);
          return null;
        }
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = (SELECT seq FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT 1)').run(key, key);
        this.cleanupListIfEmpty(key);
        return row.value;
      }
      const rows = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT ?').all(key, count) as { value: string }[];
      if (rows.length === 0) {
        this.cleanupListIfEmpty(key);
        return null;
      }
      for (const row of rows) {
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND value = ? AND seq = (SELECT seq FROM list_store WHERE key = ? AND value = ? ORDER BY seq DESC LIMIT 1)').run(key, row.value, key, row.value);
      }
      this.cleanupListIfEmpty(key);
      return rows.map(r => r.value);
    });
    const result = tx();
    if (count === undefined || count === 1) {
      return result as string | null;
    }
    return result as string[] | null;
  }

  async llen(key: string): Promise<number> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return 0;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
    return row.cnt;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return [];
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const lenRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
    const len = lenRow.cnt;
    if (len === 0) return [];
    let s = start;
    let e = stop;
    if (s < 0) s = Math.max(len + s, 0);
    if (e < 0) e = len + e;
    if (s > e || s >= len) return [];
    if (e >= len) e = len - 1;
    const limit = e - s + 1;
    const rows = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT ? OFFSET ?').all(key, limit, s) as { value: string }[];
    return rows.map(r => r.value);
  }

  async lindex(key: string, index: number): Promise<string | null> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return null;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const lenRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
    const len = lenRow.cnt;
    let idx = index;
    if (idx < 0) idx = len + idx;
    if (idx < 0 || idx >= len) return null;
    const row = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT 1 OFFSET ?').get(key, idx) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async lset(key: string, index: number, element: string): Promise<void> {
    this.evictExpired(key);
    this.ensureListTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      this.ensureListKvStoreEntry(key);
      const lenRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
      let idx = index;
      if (idx < 0) idx = lenRow.cnt + idx;
      if (idx < 0 || idx >= lenRow.cnt) {
        throw new Error('ERR index out of range');
      }
      const seqRow = this.db.prepare('SELECT seq FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT 1 OFFSET ?').get(key, idx) as { seq: number };
      this.db.prepare('UPDATE list_store SET value = ? WHERE key = ? AND seq = ?').run(element, key, seqRow.seq);
    });
    tx();
  }

  async lrem(key: string, count: number, element: string): Promise<number> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return 0;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      let removed = 0;
      if (count > 0) {
        const rows = this.db.prepare('SELECT seq FROM list_store WHERE key = ? AND value = ? ORDER BY seq ASC LIMIT ?').all(key, element, count) as { seq: number }[];
        for (const row of rows) {
          this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(key, row.seq);
        }
        removed = rows.length;
      } else if (count < 0) {
        const rows = this.db.prepare('SELECT seq FROM list_store WHERE key = ? AND value = ? ORDER BY seq DESC LIMIT ?').all(key, element, Math.abs(count)) as { seq: number }[];
        for (const row of rows) {
          this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(key, row.seq);
        }
        removed = rows.length;
      } else {
        const result = this.db.prepare('DELETE FROM list_store WHERE key = ? AND value = ?').run(key, element);
        removed = result.changes;
      }
      this.cleanupListIfEmpty(key);
      return removed;
    });
    return tx();
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      const lenRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
      const len = lenRow.cnt;
      if (len === 0) {
        this.cleanupListIfEmpty(key);
        return;
      }
      let s = start;
      let e = stop;
      if (s < 0) s = Math.max(len + s, 0);
      if (e < 0) e = len + e;
      if (s > e || s >= len) {
        this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
        this.cleanupListIfEmpty(key);
        return;
      }
      if (e >= len) e = len - 1;
      // Get the seq range to keep
      const keepSeqs = this.db.prepare('SELECT seq FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT ? OFFSET ?').all(key, e - s + 1, s) as { seq: number }[];
      if (keepSeqs.length === 0) {
        this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
        this.cleanupListIfEmpty(key);
        return;
      }
      const placeholders = keepSeqs.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM list_store WHERE key = ? AND seq NOT IN (${placeholders})`).run(key, ...keepSeqs.map(r => r.seq));
      this.cleanupListIfEmpty(key);
    });
    tx();
  }

  async lpos(key: string, element: string, options?: { rank?: number; maxlen?: number }): Promise<number | null> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return null;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const rank = options?.rank ?? 1;
    const maxlen = options?.maxlen;
    const limit = maxlen ?? -1;
    let rows: { value: string }[];
    if (limit >= 0) {
      rows = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT ?').all(key, limit) as { value: string }[];
    } else {
      rows = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC').all(key) as { value: string }[];
    }
    let matchCount = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].value === element) {
        matchCount++;
        if (matchCount === rank) {
          return i;
        }
      }
    }
    return null;
  }

  async rpoplpush(source: string, destination: string): Promise<string | null> {
    this.evictExpired(source);
    this.evictExpired(destination);
    this.ensureListTypeOrThrow(source);
    this.ensureListTypeOrThrow(destination);

    const tx = this.db.transaction(() => {
      const srcRow = this.db.prepare('SELECT seq, value FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT 1').get(source) as { seq: number; value: string } | undefined;
      if (!srcRow) return null;
      // Remove from source
      this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(source, srcRow.seq);
      // Push to destination (left)
      this.ensureListKvStoreEntry(destination);
      const minSeqRow = this.db.prepare('SELECT MIN(seq) as minSeq FROM list_store WHERE key = ?').get(destination) as { minSeq: number | null };
      const destSeq = minSeqRow.minSeq !== null ? minSeqRow.minSeq - 1 : 0;
      this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(destination, destSeq, srcRow.value);
      this.cleanupListIfEmpty(source);
      return srcRow.value;
    });
    return tx();
  }

  async lpushx(key: string, element: string): Promise<number> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return 0;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      const minSeqRow = this.db.prepare('SELECT MIN(seq) as minSeq FROM list_store WHERE key = ?').get(key) as { minSeq: number | null };
      const seq = minSeqRow.minSeq !== null ? minSeqRow.minSeq - 1 : 0;
      this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(key, seq, element);
      const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
      return countRow.cnt;
    });
    return tx();
  }

  async rpushx(key: string, element: string): Promise<number> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return 0;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      const maxSeqRow = this.db.prepare('SELECT MAX(seq) as maxSeq FROM list_store WHERE key = ?').get(key) as { maxSeq: number | null };
      const seq = maxSeqRow.maxSeq !== null ? maxSeqRow.maxSeq + 1 : 1;
      this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(key, seq, element);
      const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
      return countRow.cnt;
    });
    return tx();
  }

  async linsert(key: string, position: 'BEFORE' | 'AFTER', pivot: string, element: string): Promise<number> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return 0;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      // Find pivot
      const pivotRow = this.db.prepare('SELECT seq FROM list_store WHERE key = ? AND value = ? ORDER BY seq ASC LIMIT 1').get(key, pivot) as { seq: number } | undefined;
      if (!pivotRow) return -1;

      let newSeq: number;
      if (position === 'BEFORE') {
        const prevRow = this.db.prepare('SELECT MAX(seq) as maxSeq FROM list_store WHERE key = ? AND seq < ?').get(key, pivotRow.seq) as { maxSeq: number | null };
        if (prevRow.maxSeq !== null) {
          newSeq = (prevRow.maxSeq + pivotRow.seq) / 2;
        } else {
          newSeq = pivotRow.seq - 1;
        }
      } else {
        const nextRow = this.db.prepare('SELECT MIN(seq) as minSeq FROM list_store WHERE key = ? AND seq > ?').get(key, pivotRow.seq) as { minSeq: number | null };
        if (nextRow.minSeq !== null) {
          newSeq = (pivotRow.seq + nextRow.minSeq) / 2;
        } else {
          newSeq = pivotRow.seq + 1;
        }
      }

      this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(key, newSeq, element);
      const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
      return countRow.cnt;
    });
    return tx();
  }

  async lmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT'): Promise<string | null> {
    this.evictExpired(source);
    this.evictExpired(destination);
    this.ensureListTypeOrThrow(source);
    this.ensureListTypeOrThrow(destination);

    const tx = this.db.transaction(() => {
      // Pop from source
      const orderClause = srcDir === 'LEFT' ? 'ASC' : 'DESC';
      const srcRow = this.db.prepare(`SELECT seq, value FROM list_store WHERE key = ? ORDER BY seq ${orderClause} LIMIT 1`).get(source) as { seq: number; value: string } | undefined;
      if (!srcRow) return null;
      this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(source, srcRow.seq);

      // Push to destination
      this.ensureListKvStoreEntry(destination);
      if (destDir === 'LEFT') {
        const minSeqRow = this.db.prepare('SELECT MIN(seq) as minSeq FROM list_store WHERE key = ?').get(destination) as { minSeq: number | null };
        const destSeq = minSeqRow.minSeq !== null ? minSeqRow.minSeq - 1 : 0;
        this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(destination, destSeq, srcRow.value);
      } else {
        const maxSeqRow = this.db.prepare('SELECT MAX(seq) as maxSeq FROM list_store WHERE key = ?').get(destination) as { maxSeq: number | null };
        const destSeq = maxSeqRow.maxSeq !== null ? maxSeqRow.maxSeq + 1 : 1;
        this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(destination, destSeq, srcRow.value);
      }
      this.cleanupListIfEmpty(source);
      return srcRow.value;
    });
    return tx();
  }

  async blpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null> {
    for (const key of keys) {
      this.evictExpired(key);
      const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
      if (typeRow && typeRow.type !== 'list') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
      }
      if (!typeRow) continue;
      const tx = this.db.transaction(() => {
        const row = this.db.prepare('SELECT seq, value FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT 1').get(key) as { seq: number; value: string } | undefined;
        if (!row) return null;
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(key, row.seq);
        this.cleanupListIfEmpty(key);
        return { key, element: row.value };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  }

  async brpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null> {
    for (const key of keys) {
      this.evictExpired(key);
      const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
      if (typeRow && typeRow.type !== 'list') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
      }
      if (!typeRow) continue;
      const tx = this.db.transaction(() => {
        const row = this.db.prepare('SELECT seq, value FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT 1').get(key) as { seq: number; value: string } | undefined;
        if (!row) return null;
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(key, row.seq);
        this.cleanupListIfEmpty(key);
        return { key, element: row.value };
      });
      const result = tx();
      if (result) return result;
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
      this.evictExpired(key);
      const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
      if (typeRow && typeRow.type !== 'list') {
        throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
      }
      if (!typeRow) continue;
      const tx = this.db.transaction(() => {
        const orderClause = dir === 'LEFT' ? 'ASC' : 'DESC';
        const rows = this.db.prepare(`SELECT seq, value FROM list_store WHERE key = ? ORDER BY seq ${orderClause} LIMIT ?`).all(key, effectiveCount) as { seq: number; value: string }[];
        if (rows.length === 0) return null;
        for (const row of rows) {
          this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(key, row.seq);
        }
        this.cleanupListIfEmpty(key);
        return { key, elements: rows.map(r => r.value) };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  }

  // === Set helpers ===

  private ensureSetTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'set') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private ensureSetKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'set') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'set', NULL)").run(key);
    }
  }

  private cleanupSetIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow || typeRow.type !== 'set') return;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM set_store WHERE key = ?').get(key) as { cnt: number };
    if (row.cnt === 0) {
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
  }

  // === Set operations ===

  async sadd(key: string, members: string[]): Promise<number> {
    this.evictExpired(key);
    const tx = this.db.transaction(() => {
      this.ensureSetKvStoreEntry(key);
      let added = 0;
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)');
      for (const member of members) {
        const result = insertStmt.run(key, member);
        added += result.changes;
      }
      return added;
    });
    return tx();
  }

  async srem(key: string, members: string[]): Promise<number> {
    this.evictExpired(key);
    this.ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      let removed = 0;
      const deleteStmt = this.db.prepare('DELETE FROM set_store WHERE key = ? AND member = ?');
      for (const member of members) {
        const result = deleteStmt.run(key, member);
        removed += result.changes;
      }
      this.cleanupSetIfEmpty(key);
      return removed;
    });
    return tx();
  }

  async smembers(key: string): Promise<string[]> {
    this.evictExpired(key);
    this.ensureSetTypeOrThrow(key);
    const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(key) as { member: string }[];
    return rows.map(r => r.member);
  }

  async scard(key: string): Promise<number> {
    this.evictExpired(key);
    this.ensureSetTypeOrThrow(key);
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM set_store WHERE key = ?').get(key) as { cnt: number };
    return row.cnt;
  }

  async sismember(key: string, member: string): Promise<boolean> {
    this.evictExpired(key);
    this.ensureSetTypeOrThrow(key);
    const row = this.db.prepare('SELECT 1 FROM set_store WHERE key = ? AND member = ? LIMIT 1').get(key, member);
    return !!row;
  }

  async smismember(key: string, members: string[]): Promise<boolean[]> {
    this.evictExpired(key);
    this.ensureSetTypeOrThrow(key);
    if (members.length === 0) return [];
    const placeholders = members.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT member FROM set_store WHERE key = ? AND member IN (${placeholders})`
    ).all(key, ...members) as { member: string }[];
    const found = new Set(rows.map(r => r.member));
    return members.map(m => found.has(m));
  }

  async srandmember(key: string, count?: number): Promise<string[]> {
    this.evictExpired(key);
    this.ensureSetTypeOrThrow(key);
    const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(key) as { member: string }[];
    if (rows.length === 0) return [];
    const arr = rows.map(r => r.member);
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
    this.evictExpired(key);
    this.ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const actualCount = count ?? 1;
      const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ? ORDER BY RANDOM() LIMIT ?').all(key, actualCount) as { member: string }[];
      if (rows.length === 0) return [];
      const deleteStmt = this.db.prepare('DELETE FROM set_store WHERE key = ? AND member = ?');
      for (const row of rows) {
        deleteStmt.run(key, row.member);
      }
      this.cleanupSetIfEmpty(key);
      return rows.map(r => r.member);
    });
    return tx();
  }

  async smove(source: string, destination: string, member: string): Promise<boolean> {
    this.evictExpired(source);
    this.evictExpired(destination);
    this.ensureSetTypeOrThrow(source);
    this.ensureSetTypeOrThrow(destination);
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT 1 FROM set_store WHERE key = ? AND member = ?').get(source, member);
      if (!row) return false;
      this.db.prepare('DELETE FROM set_store WHERE key = ? AND member = ?').run(source, member);
      if (source !== destination) {
        this.ensureSetKvStoreEntry(destination);
        this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)').run(destination, member);
      } else {
        this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)').run(source, member);
      }
      this.cleanupSetIfEmpty(source);
      return true;
    });
    return tx();
  }

  async sdiff(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const firstRows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(keys[0]) as { member: string }[];
    if (firstRows.length === 0) return [];
    const firstMembers = new Set(firstRows.map(r => r.member));
    for (let i = 1; i < keys.length; i++) {
      const otherRows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(keys[i]) as { member: string }[];
      for (const row of otherRows) {
        firstMembers.delete(row.member);
      }
    }
    return Array.from(firstMembers);
  }

  async sinter(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const firstRows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(keys[0]) as { member: string }[];
    if (firstRows.length === 0) return [];
    let result = new Set(firstRows.map(r => r.member));
    for (let i = 1; i < keys.length; i++) {
      const otherRows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(keys[i]) as { member: string }[];
      if (otherRows.length === 0) return [];
      const otherSet = new Set(otherRows.map(r => r.member));
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
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const result = new Set<string>();
    for (const key of keys) {
      const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(key) as { member: string }[];
      for (const row of rows) {
        result.add(row.member);
      }
    }
    return Array.from(result);
  }

  async sdiffstore(destination: string, keys: string[]): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this.ensureSetTypeOrThrow(destination);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const diff = this._computeSetDiff(keys);
      if (diff.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'set') {
          this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this.ensureSetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)');
      for (const member of diff) {
        insertStmt.run(destination, member);
      }
      return diff.length;
    });
    return tx();
  }

  async sinterstore(destination: string, keys: string[]): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this.ensureSetTypeOrThrow(destination);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const inter = this._computeSetInter(keys);
      if (inter.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'set') {
          this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this.ensureSetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)');
      for (const member of inter) {
        insertStmt.run(destination, member);
      }
      return inter.length;
    });
    return tx();
  }

  async sunionstore(destination: string, keys: string[]): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this.ensureSetTypeOrThrow(destination);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const union = this._computeSetUnion(keys);
      if (union.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'set') {
          this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this.ensureSetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)');
      for (const member of union) {
        insertStmt.run(destination, member);
      }
      return union.length;
    });
    return tx();
  }

  private _computeSetDiff(keys: string[]): string[] {
    if (keys.length === 0) return [];
    const firstRows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(keys[0]) as { member: string }[];
    if (firstRows.length === 0) return [];
    const firstMembers = new Set(firstRows.map(r => r.member));
    for (let i = 1; i < keys.length; i++) {
      const otherRows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(keys[i]) as { member: string }[];
      for (const row of otherRows) {
        firstMembers.delete(row.member);
      }
    }
    return Array.from(firstMembers);
  }

  private _computeSetInter(keys: string[]): string[] {
    if (keys.length === 0) return [];
    const firstRows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(keys[0]) as { member: string }[];
    if (firstRows.length === 0) return [];
    let result = new Set(firstRows.map(r => r.member));
    for (let i = 1; i < keys.length; i++) {
      const otherRows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(keys[i]) as { member: string }[];
      if (otherRows.length === 0) return [];
      const otherSet = new Set(otherRows.map(r => r.member));
      const next = new Set<string>();
      for (const member of result) {
        if (otherSet.has(member)) next.add(member);
      }
      result = next;
      if (result.size === 0) return [];
    }
    return Array.from(result);
  }

  private _computeSetUnion(keys: string[]): string[] {
    if (keys.length === 0) return [];
    const result = new Set<string>();
    for (const key of keys) {
      const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(key) as { member: string }[];
      for (const row of rows) {
        result.add(row.member);
      }
    }
    return Array.from(result);
  }

  async sintercard(keys: string[], limit?: number): Promise<number> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureSetTypeOrThrow(key);
    const inter = this._computeSetInter(keys);
    if (limit !== undefined) {
      return Math.min(inter.length, limit);
    }
    return inter.length;
  }

  async sscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]> {
    this.evictExpired(key);
    this.ensureSetTypeOrThrow(key);
    const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ? ORDER BY member').all(key) as { member: string }[];
    if (rows.length === 0) return [0, []];
    const allMembers = rows.map(r => r.member);
    const effectiveCount = count ?? 10;
    let idx = cursor;
    let scanned = 0;
    const regex = pattern ? globToRegex(pattern) : null;
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