import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { IStorage, StorageConfig, StreamEntry, StreamConsumer, StreamInfo, GroupInfo, PendingEntry, GeoSearchResult } from './interface';

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
  private startTime = Date.now();
  private lastSaveTime: number = 0;

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
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS zset_store (key TEXT NOT NULL, member TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY (key, member))'
    ).run();
    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_zset_score ON zset_store(key, score, member)'
    ).run();

    // Stream tables
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS stream_entries (key TEXT NOT NULL, id TEXT NOT NULL, fields TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (key, id))'
    ).run();
    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_stream_entries_key_id ON stream_entries(key, id)'
    ).run();
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS stream_meta (key TEXT PRIMARY KEY, last_id TEXT NOT NULL DEFAULT \'0-0\', max_deleted_id TEXT NOT NULL DEFAULT \'0-0\', entries_added INTEGER NOT NULL DEFAULT 0, recorded_first_id TEXT NOT NULL DEFAULT \'0-0\')'
    ).run();
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS stream_groups (key TEXT NOT NULL, group_name TEXT NOT NULL, last_delivered_id TEXT NOT NULL, entries_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, group_name))'
    ).run();
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS stream_consumers (key TEXT NOT NULL, group_name TEXT NOT NULL, consumer_name TEXT NOT NULL, pending_count INTEGER NOT NULL DEFAULT 0, idle_time INTEGER NOT NULL DEFAULT 0, last_delivered_id TEXT NOT NULL DEFAULT \'0-0\', last_ack_time INTEGER NOT NULL DEFAULT 0, seen_time INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, group_name, consumer_name))'
    ).run();
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS stream_pending (key TEXT NOT NULL, id TEXT NOT NULL, group_name TEXT NOT NULL, consumer_name TEXT NOT NULL, delivered_time INTEGER NOT NULL, delivery_count INTEGER NOT NULL DEFAULT 1, last_delivered_time INTEGER NOT NULL, PRIMARY KEY (key, id, group_name))'
    ).run();
    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_stream_pending_group ON stream_pending(key, group_name)'
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
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_entries WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_meta WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_groups WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_consumers WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_pending WHERE key = ?').run(key);
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
      "DELETE FROM zset_store WHERE key IN (SELECT key FROM kv_store WHERE type = 'zset' AND expires_at IS NOT NULL AND expires_at <= ?)"
    ).run(Date.now());
    this.db.prepare(
      "DELETE FROM stream_entries WHERE key IN (SELECT key FROM kv_store WHERE type = 'stream' AND expires_at IS NOT NULL AND expires_at <= ?)"
    ).run(Date.now());
    this.db.prepare(
      "DELETE FROM stream_meta WHERE key IN (SELECT key FROM kv_store WHERE type = 'stream' AND expires_at IS NOT NULL AND expires_at <= ?)"
    ).run(Date.now());
    this.db.prepare(
      "DELETE FROM stream_groups WHERE key IN (SELECT key FROM kv_store WHERE type = 'stream' AND expires_at IS NOT NULL AND expires_at <= ?)"
    ).run(Date.now());
    this.db.prepare(
      "DELETE FROM stream_consumers WHERE key IN (SELECT key FROM kv_store WHERE type = 'stream' AND expires_at IS NOT NULL AND expires_at <= ?)"
    ).run(Date.now());
    this.db.prepare(
      "DELETE FROM stream_pending WHERE key IN (SELECT key FROM kv_store WHERE type = 'stream' AND expires_at IS NOT NULL AND expires_at <= ?)"
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
    this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM stream_entries WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM stream_meta WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM stream_groups WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM stream_consumers WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM stream_pending WHERE key = ?').run(key);
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
    this.db.prepare('DELETE FROM zset_store').run();
    this.db.prepare('DELETE FROM stream_entries').run();
    this.db.prepare('DELETE FROM stream_meta').run();
    this.db.prepare('DELETE FROM stream_groups').run();
    this.db.prepare('DELETE FROM stream_consumers').run();
    this.db.prepare('DELETE FROM stream_pending').run();
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
      this.db.prepare('UPDATE zset_store SET key = ? WHERE key = ?').run(newKey, oldKey);
      // For stream type, also update stream tables
      const streamType = row.type === 'stream';
      if (streamType) {
        this.db.prepare('UPDATE stream_entries SET key = ? WHERE key = ?').run(newKey, oldKey);
        this.db.prepare('UPDATE stream_meta SET key = ? WHERE key = ?').run(newKey, oldKey);
        this.db.prepare('UPDATE stream_groups SET key = ? WHERE key = ?').run(newKey, oldKey);
        this.db.prepare('UPDATE stream_consumers SET key = ? WHERE key = ?').run(newKey, oldKey);
        this.db.prepare('UPDATE stream_pending SET key = ? WHERE key = ?').run(newKey, oldKey);
      }
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
    if (row.type === 'zset') {
      this.db.prepare(
        'INSERT OR REPLACE INTO zset_store (key, member, score) SELECT ?, member, score FROM zset_store WHERE key = ?'
      ).run(destination, source);
    }
    if (row.type === 'stream') {
      this.db.prepare(
        'INSERT OR REPLACE INTO stream_entries (key, id, fields, created_at) SELECT ?, id, fields, created_at FROM stream_entries WHERE key = ?'
      ).run(destination, source);
      this.db.prepare(
        'INSERT OR REPLACE INTO stream_meta (key, last_id, max_deleted_id, entries_added, recorded_first_id) SELECT ?, last_id, max_deleted_id, entries_added, recorded_first_id FROM stream_meta WHERE key = ?'
      ).run(destination, source);
      this.db.prepare(
        'INSERT OR REPLACE INTO stream_groups (key, group_name, last_delivered_id, entries_read) SELECT ?, group_name, last_delivered_id, entries_read FROM stream_groups WHERE key = ?'
      ).run(destination, source);
      this.db.prepare(
        'INSERT OR REPLACE INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) SELECT ?, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time FROM stream_consumers WHERE key = ?'
      ).run(destination, source);
      this.db.prepare(
        'INSERT OR REPLACE INTO stream_pending (key, id, group_name, consumer_name, delivered_time, delivery_count, last_delivered_time) SELECT ?, id, group_name, consumer_name, delivered_time, delivery_count, last_delivered_time FROM stream_pending WHERE key = ?'
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
    this.db.prepare(
      `DELETE FROM zset_store WHERE key IN (${placeholders})`
    ).run(...keys);
    this.db.prepare(
      `DELETE FROM stream_entries WHERE key IN (${placeholders})`
    ).run(...keys);
    this.db.prepare(
      `DELETE FROM stream_meta WHERE key IN (${placeholders})`
    ).run(...keys);
    this.db.prepare(
      `DELETE FROM stream_groups WHERE key IN (${placeholders})`
    ).run(...keys);
    this.db.prepare(
      `DELETE FROM stream_consumers WHERE key IN (${placeholders})`
    ).run(...keys);
    this.db.prepare(
      `DELETE FROM stream_pending WHERE key IN (${placeholders})`
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

  // === Sorted Set helpers ===

  private ensureZsetTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private ensureZsetKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'zset', NULL)").run(key);
    }
  }

  private cleanupZsetIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    // CRITICAL: must check type === 'zset' before deleting (Phase 2 bug pattern)
    if (!typeRow || typeRow.type !== 'zset') return;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
    if (row.cnt === 0) {
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
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

  private buildScoreWhereClause(min: { value: number; exclusive: boolean }, max: { value: number; exclusive: boolean }): { sql: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];
    if (min.value === -Infinity) {
      // no lower bound
    } else if (min.exclusive) {
      conditions.push('score > ?');
      params.push(min.value);
    } else {
      conditions.push('score >= ?');
      params.push(min.value);
    }
    if (max.value === Infinity) {
      // no upper bound
    } else if (max.exclusive) {
      conditions.push('score < ?');
      params.push(max.value);
    } else {
      conditions.push('score <= ?');
      params.push(max.value);
    }
    return { sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1', params };
  }

  private buildLexWhereClause(min: { value: string; exclusive: boolean; infinite: boolean }, max: { value: string; exclusive: boolean; infinite: boolean }): { sql: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];
    if (!min.infinite) {
      if (min.exclusive) {
        conditions.push('member > ?');
        params.push(min.value);
      } else {
        conditions.push('member >= ?');
        params.push(min.value);
      }
    }
    if (!max.infinite) {
      if (max.exclusive) {
        conditions.push('member < ?');
        params.push(max.value);
      } else {
        conditions.push('member <= ?');
        params.push(max.value);
      }
    }
    return { sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1', params };
  }

  private formatScore(score: number): string {
    return parseFloat(score.toPrecision(15)).toString();
  }

  // === Sorted Set operations ===

  async zadd(key: string, scoreMembers: Array<{ score: number; member: string }>, options?: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean; ch?: boolean; incr?: boolean }): Promise<number | string | null> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);

    if (options?.incr) {
      const { score, member } = scoreMembers[0];
      const tx = this.db.transaction(() => {
        const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
        if (!row) {
          if (options.xx) return null;
          this.ensureZsetKvStoreEntry(key);
          this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(key, member, score);
          return this.formatScore(score);
        } else {
          if (options.nx) return this.formatScore(row.score);
          const current = row.score;
          if (options.gt && score <= 0) return this.formatScore(current);
          if (options.lt && score >= 0) return this.formatScore(current);
          if (options.gt && current + score <= current) return this.formatScore(current);
          if (options.lt && current + score >= current) return this.formatScore(current);
          const newScore = current + score;
          this.db.prepare('UPDATE zset_store SET score = ? WHERE key = ? AND member = ?').run(newScore, key, member);
          return this.formatScore(newScore);
        }
      });
      return tx();
    }

    // Non-INCR mode
    const tx = this.db.transaction(() => {
      let added = 0;
      let changed = 0;
      for (const { score, member } of scoreMembers) {
        const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
        if (!row) {
          if (options?.xx) continue;
          this.ensureZsetKvStoreEntry(key);
          this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(key, member, score);
          added++;
        } else {
          if (options?.nx) continue;
          const current = row.score;
          if (options?.gt && score <= current) continue;
          if (options?.lt && score >= current) continue;
          if (current !== score) changed++;
          this.db.prepare('UPDATE zset_store SET score = ? WHERE key = ? AND member = ?').run(score, key, member);
        }
      }
      return options?.ch ? added + changed : added;
    });
    return tx();
  }

  async zrem(key: string, members: string[]): Promise<number> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      let removed = 0;
      for (const member of members) {
        const result = this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, member);
        removed += result.changes;
      }
      this.cleanupZsetIfEmpty(key);
      return removed;
    });
    return tx();
  }

  async zscore(key: string, member: string): Promise<string | null> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
    return row ? this.formatScore(row.score) : null;
  }

  async zcard(key: string): Promise<number> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
    return row.cnt;
  }

  async zrange(key: string, min: number | string, max: number | string, options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }): Promise<Array<{ member: string; score: number }>> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);

    const rev = options?.rev ?? false;
    const orderDir = rev ? 'DESC' : 'ASC';

    if (options?.byScore) {
      const parsedMin = this.parseScoreBound(min, true);
      const parsedMax = this.parseScoreBound(max, false);
      // For rev, swap bounds for query but use DESC order
      const queryMin = rev ? parsedMax : parsedMin;
      const queryMax = rev ? parsedMin : parsedMax;
      const { sql: whereClause, params: whereParams } = this.buildScoreWhereClause(queryMin, queryMax);
      let sql = `SELECT member, score FROM zset_store WHERE key = ? AND ${whereClause} ORDER BY score ${orderDir}, member ${orderDir}`;
      const allParams = [key, ...whereParams];
      if (options?.offset !== undefined || options?.count !== undefined) {
        const offset = options?.offset ?? 0;
        const count = options?.count ?? -1;
        sql += ' LIMIT ? OFFSET ?';
        allParams.push(count, offset);
      }
      const rows = this.db.prepare(sql).all(...allParams) as { member: string; score: number }[];
      return rows.map(r => ({ member: r.member, score: r.score }));
    } else if (options?.byLex) {
      const parsedMin = this.parseLexBound(String(min));
      const parsedMax = this.parseLexBound(String(max));
      const queryMin = rev ? parsedMax : parsedMin;
      const queryMax = rev ? parsedMin : parsedMax;
      const { sql: whereClause, params: whereParams } = this.buildLexWhereClause(queryMin, queryMax);
      let sql = `SELECT member, score FROM zset_store WHERE key = ? AND ${whereClause} ORDER BY score ${orderDir}, member ${orderDir}`;
      const allParams = [key, ...whereParams];
      if (options?.offset !== undefined || options?.count !== undefined) {
        const offset = options?.offset ?? 0;
        const count = options?.count ?? -1;
        sql += ' LIMIT ? OFFSET ?';
        allParams.push(count, offset);
      }
      const rows = this.db.prepare(sql).all(...allParams) as { member: string; score: number }[];
      return rows.map(r => ({ member: r.member, score: r.score }));
    } else {
      // Index mode
      let start = typeof min === 'number' ? min : parseInt(String(min), 10);
      let stop = typeof max === 'number' ? max : parseInt(String(max), 10);
      const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
      const len = cntRow.cnt;
      if (len === 0) return [];
      if (start < 0) start = Math.max(len + start, 0);
      if (stop < 0) stop = len + stop;
      if (start > stop || start >= len) return [];
      if (stop >= len) stop = len - 1;
      const limit = stop - start + 1;
      let sql = `SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ${orderDir}, member ${orderDir} LIMIT ? OFFSET ?`;
      const rows = this.db.prepare(sql).all(key, limit, start) as { member: string; score: number }[];
      return rows.map(r => ({ member: r.member, score: r.score }));
    }
  }

  async zrank(key: string, member: string): Promise<number | null> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
    if (!row) return null;
    const cntRow = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM zset_store WHERE key = ? AND (score < ? OR (score = ? AND member < ?))'
    ).get(key, row.score, row.score, member) as { cnt: number };
    return cntRow.cnt;
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
    if (!row) return null;
    const cntRow = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM zset_store WHERE key = ? AND (score > ? OR (score = ? AND member > ?))'
    ).get(key, row.score, row.score, member) as { cnt: number };
    return cntRow.cnt;
  }

  async zincrby(key: string, increment: number, member: string): Promise<string> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      this.ensureZsetKvStoreEntry(key);
      const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
      const current = row ? row.score : 0;
      const newScore = current + increment;
      this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(key, member, newScore);
      return this.formatScore(newScore);
    });
    return tx();
  }

  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const parsedMin = this.parseScoreBound(min, true);
    const parsedMax = this.parseScoreBound(max, false);
    const { sql: whereClause, params: whereParams } = this.buildScoreWhereClause(parsedMin, parsedMax);
    const sql = `SELECT COUNT(*) as cnt FROM zset_store WHERE key = ? AND ${whereClause}`;
    const row = this.db.prepare(sql).get(key, ...whereParams) as { cnt: number };
    return row.cnt;
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
      if (cntRow.cnt === 0) return 0;
      const len = cntRow.cnt;
      let s = start;
      let e = stop;
      if (s < 0) s = Math.max(len + s, 0);
      if (e < 0) e = len + e;
      if (s > e || s >= len) return 0;
      if (e >= len) e = len - 1;
      // Get member+score at the rank range, then delete them
      const toRemove = this.db.prepare(
        'SELECT member FROM zset_store WHERE key = ? ORDER BY score ASC, member ASC LIMIT ? OFFSET ?'
      ).all(key, e - s + 1, s) as { member: string }[];
      for (const item of toRemove) {
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, item.member);
      }
      this.cleanupZsetIfEmpty(key);
      return toRemove.length;
    });
    return tx();
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const parsedMin = this.parseScoreBound(min, true);
      const parsedMax = this.parseScoreBound(max, false);
      const { sql: whereClause, params: whereParams } = this.buildScoreWhereClause(parsedMin, parsedMax);
      const sql = `DELETE FROM zset_store WHERE key = ? AND ${whereClause}`;
      const result = this.db.prepare(sql).run(key, ...whereParams);
      this.cleanupZsetIfEmpty(key);
      return result.changes;
    });
    return tx();
  }

  async zremrangebylex(key: string, min: string, max: string): Promise<number> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const parsedMin = this.parseLexBound(min);
      const parsedMax = this.parseLexBound(max);
      const { sql: whereClause, params: whereParams } = this.buildLexWhereClause(parsedMin, parsedMax);
      if (whereClause === '1=1') {
        // No bounds: delete all
        const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
        this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(key);
        this.cleanupZsetIfEmpty(key);
        return cntRow.cnt;
      }
      const sql = `DELETE FROM zset_store WHERE key = ? AND ${whereClause}`;
      const result = this.db.prepare(sql).run(key, ...whereParams);
      this.cleanupZsetIfEmpty(key);
      return result.changes;
    });
    return tx();
  }

  async zlexcount(key: string, min: string, max: string): Promise<number> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const parsedMin = this.parseLexBound(min);
    const parsedMax = this.parseLexBound(max);
    const { sql: whereClause, params: whereParams } = this.buildLexWhereClause(parsedMin, parsedMax);
    if (whereClause === '1=1') {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
      return row.cnt;
    }
    const sql = `SELECT COUNT(*) as cnt FROM zset_store WHERE key = ? AND ${whereClause}`;
    const row = this.db.prepare(sql).get(key, ...whereParams) as { cnt: number };
    return row.cnt;
  }

  async zscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const rows = this.db.prepare('SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ASC, member ASC').all(key) as { member: string; score: number }[];
    if (rows.length === 0) return [0, []];
    const effectiveCount = count ?? 10;
    const regex = pattern ? globToRegex(pattern) : null;
    const result: string[] = [];
    let idx = cursor;
    while (idx < rows.length && result.length < effectiveCount * 2) {
      const row = rows[idx];
      idx++;
      if (!regex || regex.test(row.member)) {
        result.push(row.member, this.formatScore(row.score));
      }
    }
    const nextCursor = idx >= rows.length ? 0 : idx;
    return [nextCursor, result];
  }

  async zpopmax(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const actualCount = count ?? 1;
      const rows = this.db.prepare(
        'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score DESC, member DESC LIMIT ?'
      ).all(key, actualCount) as { member: string; score: number }[];
      if (rows.length === 0) return [];
      for (const row of rows) {
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
      }
      this.cleanupZsetIfEmpty(key);
      // Return in descending score order
      return rows.map(r => ({ member: r.member, score: r.score }));
    });
    return tx();
  }

  async zpopmin(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const actualCount = count ?? 1;
      const rows = this.db.prepare(
        'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ASC, member ASC LIMIT ?'
      ).all(key, actualCount) as { member: string; score: number }[];
      if (rows.length === 0) return [];
      for (const row of rows) {
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
      }
      this.cleanupZsetIfEmpty(key);
      return rows.map(r => ({ member: r.member, score: r.score }));
    });
    return tx();
  }

  async zrandmember(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    if (count === undefined) {
      const row = this.db.prepare('SELECT member, score FROM zset_store WHERE key = ? ORDER BY RANDOM() LIMIT 1').get(key) as { member: string; score: number } | undefined;
      return row ? [{ member: row.member, score: row.score }] : [];
    }
    if (count > 0) {
      const rows = this.db.prepare('SELECT member, score FROM zset_store WHERE key = ? ORDER BY RANDOM() LIMIT ?').all(key, count) as { member: string; score: number }[];
      return rows.map(r => ({ member: r.member, score: r.score }));
    } else {
      const allRows = this.db.prepare('SELECT member, score FROM zset_store WHERE key = ?').all(key) as { member: string; score: number }[];
      if (allRows.length === 0) return [];
      const result: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < Math.abs(count); i++) {
        const idx = Math.floor(Math.random() * allRows.length);
        result.push({ member: allRows[idx].member, score: allRows[idx].score });
      }
      return result;
    }
  }

  async zmscore(key: string, members: string[]): Promise<(string | null)[]> {
    this.evictExpired(key);
    this.ensureZsetTypeOrThrow(key);
    if (members.length === 0) return [];
    const placeholders = members.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT member, score FROM zset_store WHERE key = ? AND member IN (${placeholders})`
    ).all(key, ...members) as { member: string; score: number }[];
    const map = new Map(rows.map(r => [r.member, r.score] as [string, number]));
    return members.map(m => {
      const score = map.get(m);
      return score !== undefined ? this.formatScore(score) : null;
    });
  }

  async zrangestore(destination: string, source: string, min: number | string, max: number | string, options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }): Promise<number> {
    this.evictExpired(destination);
    this.evictExpired(source);
    this.ensureZsetTypeOrThrow(source);
    this.ensureZsetTypeOrThrow(destination);
    const range = await this.zrange(source, min, max, options);
    const tx = this.db.transaction(() => {
      if (range.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'zset') {
          this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this.ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of range) {
        this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, item.member, item.score);
      }
      return range.length;
    });
    return tx();
  }

  async zdiff(keys: string[]): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const firstRows = this.db.prepare('SELECT member, score FROM zset_store WHERE key = ?').all(keys[0]) as { member: string; score: number }[];
    if (firstRows.length === 0) return [];
    const firstEntries = new Map<string, number>(firstRows.map(r => [r.member, r.score] as [string, number]));
    for (let i = 1; i < keys.length; i++) {
      const otherRows = this.db.prepare('SELECT member FROM zset_store WHERE key = ?').all(keys[i]) as { member: string }[];
      for (const row of otherRows) {
        firstEntries.delete(row.member);
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
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this.ensureZsetTypeOrThrow(destination);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    const diff = await this.zdiff(keys);
    const tx = this.db.transaction(() => {
      if (diff.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'zset') {
          this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this.ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of diff) {
        this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, item.member, item.score);
      }
      return diff.length;
    });
    return tx();
  }

  async zunion(keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const weights = options?.weights ?? keys.map(() => 1);
    const aggregate = options?.aggregate ?? 'SUM';
    const memberScores = new Map<string, number[]>();
    for (let i = 0; i < keys.length; i++) {
      const weight = weights[i] ?? 1;
      const rows = this.db.prepare('SELECT member, score FROM zset_store WHERE key = ?').all(keys[i]) as { member: string; score: number }[];
      for (const row of rows) {
        if (!memberScores.has(row.member)) memberScores.set(row.member, []);
        memberScores.get(row.member)!.push(row.score * weight);
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
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this.ensureZsetTypeOrThrow(destination);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    const union = await this.zunion(keys, options);
    const tx = this.db.transaction(() => {
      if (union.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'zset') {
          this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this.ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of union) {
        this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, item.member, item.score);
      }
      return union.length;
    });
    return tx();
  }

  async zinter(keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const weights = options?.weights ?? keys.map(() => 1);
    const aggregate = options?.aggregate ?? 'SUM';
    const memberKeyScores = new Map<string, Map<number, number>>();
    for (let i = 0; i < keys.length; i++) {
      const weight = weights[i] ?? 1;
      const rows = this.db.prepare('SELECT member, score FROM zset_store WHERE key = ?').all(keys[i]) as { member: string; score: number }[];
      for (const row of rows) {
        if (!memberKeyScores.has(row.member)) memberKeyScores.set(row.member, new Map());
        memberKeyScores.get(row.member)!.set(i, row.score * weight);
      }
    }
    const result: Array<{ member: string; score: number }> = [];
    for (const [member, keyScores] of memberKeyScores) {
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
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this.ensureZsetTypeOrThrow(destination);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    const inter = await this.zinter(keys, options);
    const tx = this.db.transaction(() => {
      if (inter.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'zset') {
          this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this.ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of inter) {
        this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, item.member, item.score);
      }
      return inter.length;
    });
    return tx();
  }

  async zintercard(keys: string[], limit?: number): Promise<number> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return 0;
    let memberSets: Set<string>[] = [];
    for (const key of keys) {
      const rows = this.db.prepare('SELECT member FROM zset_store WHERE key = ?').all(key) as { member: string }[];
      if (rows.length === 0) return 0;
      memberSets.push(new Set(rows.map(r => r.member)));
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
      this.evictExpired(key);
      this.ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const row = this.db.prepare(
          'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score DESC, member DESC LIMIT 1'
        ).get(key) as { member: string; score: number } | undefined;
        if (!row) return null;
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
        this.cleanupZsetIfEmpty(key);
        return { key, member: row.member, score: row.score };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  }

  async bzpopmin(keys: string[], timeout: number): Promise<{ key: string; member: string; score: number } | null> {
    for (const key of keys) {
      this.evictExpired(key);
      this.ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const row = this.db.prepare(
          'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ASC, member ASC LIMIT 1'
        ).get(key) as { member: string; score: number } | undefined;
        if (!row) return null;
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
        this.cleanupZsetIfEmpty(key);
        return { key, member: row.member, score: row.score };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  }

  async bzmpop(numkeys: number, keys: string[], minmax: 'MIN' | 'MAX', count?: number): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    const effectiveCount = count ?? 1;
    for (const key of keys) {
      this.evictExpired(key);
      this.ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const orderClause = minmax === 'MIN' ? 'ASC' : 'DESC';
        const rows = this.db.prepare(
          `SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ${orderClause}, member ${orderClause} LIMIT ?`
        ).all(key, effectiveCount) as { member: string; score: number }[];
        if (rows.length === 0) return null;
        for (const row of rows) {
          this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
        }
        this.cleanupZsetIfEmpty(key);
        return { key, elements: rows.map(r => ({ member: r.member, score: r.score })) };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  }

  async zmpop(numkeys: number, keys: string[], minmax: 'MIN' | 'MAX', count?: number): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    return this.bzmpop(numkeys, keys, minmax, count);
  }

  // === Bitmap helpers ===

  private sqliteStringToBytes(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) { bytes.push(str.charCodeAt(i)); }
    return bytes;
  }

  private sqliteBytesToString(bytes: number[]): string { return String.fromCharCode(...bytes); }

  private sqliteGetBitAt(bytes: number[], offset: number): 0 | 1 {
    const byteIndex = Math.floor(offset / 8);
    const bitIndex = 7 - (offset % 8);
    if (byteIndex >= bytes.length) return 0;
    return ((bytes[byteIndex] >> bitIndex) & 1) as 0 | 1;
  }

  private sqliteSetBitAt(bytes: number[], offset: number, value: 0 | 1): 0 | 1 {
    const byteIndex = Math.floor(offset / 8);
    const bitIndex = 7 - (offset % 8);
    while (bytes.length <= byteIndex) bytes.push(0);
    const oldVal = (bytes[byteIndex] >> bitIndex) & 1;
    if (value === 1) { bytes[byteIndex] |= (1 << bitIndex); } else { bytes[byteIndex] &= ~(1 << bitIndex); }
    return oldVal as 0 | 1;
  }

  private ensureStringTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'string') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
  }

  private ensureHllTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'hyperloglog') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
  }

  private ensureJsonTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
  }

  // === HLL helpers ===

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

  private hllIndex(hash: bigint): number { return Number(hash & 0x3FFFn); }

  private hllRho(hash: bigint): number {
    const remaining = hash >> 14n;
    if (remaining === 0n) return 51;
    let count = 1;
    let val = remaining;
    while ((val & 1n) === 0n && count < 51) { count++; val >>= 1n; }
    return count;
  }

  private hllEncode(registers: Uint8Array): string { return Buffer.from(registers).toString('base64'); }
  private hllDecode(data: string): Uint8Array { return new Uint8Array(Buffer.from(data, 'base64')); }

  private read6BitRegister(data: Uint8Array, index: number): number {
    const bitOffset = index * 6;
    const byteOffset = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;
    let value = 0, bitsNeeded = 6, currentByte = byteOffset, currentBit = bitInByte;
    while (bitsNeeded > 0) {
      const bitsAvailable = 8 - currentBit;
      const bitsToRead = Math.min(bitsAvailable, bitsNeeded);
      const mask = ((1 << bitsToRead) - 1) << (bitsAvailable - bitsToRead);
      const bits = (data[currentByte] & mask) >> (bitsAvailable - bitsToRead);
      value = (value << bitsToRead) | bits;
      bitsNeeded -= bitsToRead; currentBit = 0; currentByte++;
    }
    return value;
  }

  private write6BitRegister(data: Uint8Array, index: number, value: number): void {
    const bitOffset = index * 6;
    const byteOffset = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;
    let bitsToWrite = 6, currentByte = byteOffset, currentBit = bitInByte, shiftedValue = value;
    while (bitsToWrite > 0) {
      const bitsAvailable = 8 - currentBit;
      const bitsToWriteNow = Math.min(bitsAvailable, bitsToWrite);
      const mask = ((1 << bitsToWriteNow) - 1);
      const bits = (shiftedValue >> (bitsToWrite - bitsToWriteNow)) & mask;
      const shift = bitsAvailable - bitsToWriteNow;
      data[currentByte] &= ~(mask << shift);
      data[currentByte] |= (bits << shift);
      bitsToWrite -= bitsToWriteNow; currentBit = 0; currentByte++;
    }
  }

  private hllEstimate(registers: Uint8Array): number {
    const m = this.HLL_REGISTERS;
    let sum = 0, zeros = 0;
    for (let i = 0; i < m; i++) {
      const regVal = this.read6BitRegister(registers, i);
      sum += 1 / Math.pow(2, regVal);
      if (regVal === 0) zeros++;
    }
    const alpha = 0.7213 / (1 + 1.079 / m);
    const estimate = alpha * m * m / sum;
    if (estimate <= 2.5 * m && zeros > 0) return Math.round(m * Math.log(m / zeros));
    return Math.max(0, Math.round(estimate));
  }

  // === JSON helpers ===

  private sqliteParseJsonPath(path: string): Array<{ type: 'field'; name: string } | { type: 'index'; index: number }> {
    let p = path;
    if (p === '$' || p === '.') return [];
    if (p.startsWith('$.')) p = p.slice(2); else if (p.startsWith('$')) p = p.slice(1); else if (p.startsWith('.')) p = p.slice(1);
    const segments: Array<{ type: 'field'; name: string } | { type: 'index'; index: number }> = [];
    let i = 0;
    while (i < p.length) {
      if (p[i] === '[') {
        const end = p.indexOf(']', i); if (end === -1) break;
        const content = p.slice(i + 1, end);
        if (/^\d+$/.test(content)) { segments.push({ type: 'index', index: parseInt(content) }); }
        else { segments.push({ type: 'field', name: content.replace(/^['"]|['"]$/g, '') }); }
        i = end + 1; if (i < p.length && p[i] === '.') i++;
      } else {
        let end = i; while (end < p.length && p[end] !== '.' && p[end] !== '[') end++;
        const fieldName = p.slice(i, end); if (fieldName) segments.push({ type: 'field', name: fieldName });
        i = end; if (i < p.length && p[i] === '.') i++;
      }
    }
    return segments;
  }

  private sqliteJsonResolvePath(root: any, path: string): { parent: any; key: string | number; value: any }[] {
    if (path === '$' || path === '.' || path === '') return [{ parent: null, key: '', value: root }];
    const segments = this.sqliteParseJsonPath(path);
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

  private sqliteJsonTypeOf(val: any): string {
    if (val === null) return 'null'; if (Array.isArray(val)) return 'array'; if (typeof val === 'object') return 'object';
    if (typeof val === 'boolean') return 'boolean'; if (typeof val === 'number') return Number.isInteger(val) ? 'integer' : 'number';
    if (typeof val === 'string') return 'string'; return 'unknown';
  }

  private sqliteDeepMerge(target: any, source: any): any {
    if (source === null) return null;
    if (typeof source !== 'object' || Array.isArray(source)) return source;
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return source;
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] === null) { delete result[key]; }
      else if (typeof source[key] === 'object' && !Array.isArray(source[key]) && typeof result[key] === 'object' && !Array.isArray(result[key])) { result[key] = this.sqliteDeepMerge(result[key], source[key]); }
      else { result[key] = source[key]; }
    }
    return result;
  }

  // === Bitmap operations ===

  async setbit(key: string, offset: number, value: 0 | 1): Promise<number> {
    this.evictExpired(key);
    this.ensureStringTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    let current: string;
    let existingExpiresAt: number | null;
    if (!row) { current = ''; existingExpiresAt = null; }
    else { current = row.value; existingExpiresAt = row.expires_at; }
    const bytes = this.sqliteStringToBytes(current);
    const oldBit = this.sqliteSetBitAt(bytes, offset, value);
    const newValue = this.sqliteBytesToString(bytes);
    this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', ?)").run(key, newValue, existingExpiresAt);
    return oldBit;
  }

  async getbit(key: string, offset: number): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return 0;
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (typeRow && typeRow.type !== 'string') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const bytes = this.sqliteStringToBytes(row.value);
    return this.sqliteGetBitAt(bytes, offset);
  }

  async bitcount(key: string, start?: number, end?: number): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return 0;
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (typeRow && typeRow.type !== 'string') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const bytes = this.sqliteStringToBytes(row.value);
    if (bytes.length === 0) return 0;
    let s = start ?? 0, e = end ?? -1;
    if (s < 0) s = Math.max(bytes.length + s, 0);
    if (e < 0) e = bytes.length + e;
    if (s > e || s >= bytes.length) return 0;
    if (e >= bytes.length) e = bytes.length - 1;
    let count = 0;
    for (let i = s; i <= e; i++) { let b = bytes[i]; while (b) { count += b & 1; b >>= 1; } }
    return count;
  }

  async bitpos(key: string, bit: 0 | 1, start?: number, end?: number): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return bit === 0 ? 0 : -1;
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (typeRow && typeRow.type !== 'string') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const bytes = this.sqliteStringToBytes(row.value);
    if (bytes.length === 0) return bit === 0 ? 0 : -1;
    let s = start ?? 0, e = end ?? bytes.length - 1;
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
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) {
      const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
      if (typeRow && typeRow.type !== 'string') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    const srcArrays: number[][] = [];
    for (const key of keys) {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      srcArrays.push(row ? this.sqliteStringToBytes(row.value) : []);
    }
    let maxLen = 0;
    for (const arr of srcArrays) { if (arr.length > maxLen) maxLen = arr.length; }
    if (operation === 'NOT') {
      if (keys.length !== 1) throw new Error('ERR BITOP NOT must have exactly one source key');
      const src = srcArrays[0];
      const result: number[] = [];
      for (let i = 0; i < src.length; i++) result.push((~src[i]) & 0xFF);
      const resultStr = this.sqliteBytesToString(result);
      this.evictExpired(destkey);
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)").run(destkey, resultStr);
      return result.length;
    }
    if (keys.length === 0) { this.evictExpired(destkey); this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destkey); return 0; }
    const result: number[] = new Array(maxLen).fill(0);
    for (let i = 0; i < maxLen; i++) {
      if (operation === 'AND') { let val = 0xFF; for (const arr of srcArrays) val &= (i < arr.length ? arr[i] : 0); result[i] = val; }
      else if (operation === 'OR') { let val = 0; for (const arr of srcArrays) val |= (i < arr.length ? arr[i] : 0); result[i] = val; }
      else if (operation === 'XOR') { let val = 0; for (const arr of srcArrays) val ^= (i < arr.length ? arr[i] : 0); result[i] = val; }
    }
    const resultStr = this.sqliteBytesToString(result);
    this.evictExpired(destkey);
    this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)").run(destkey, resultStr);
    return result.length;
  }

  async bitfield(key: string, operations: Array<{ type: 'GET' | 'SET' | 'INCRBY'; encoding: string; offset: number; value?: number; overflow?: 'WRAP' | 'SAT' | 'FAIL' }>): Promise<(number | null)[]> {
    this.evictExpired(key);
    this.ensureStringTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    let current: string;
    let existingExpiresAt: number | null;
    if (!row) { current = ''; existingExpiresAt = null; } else { current = row.value; existingExpiresAt = row.expires_at; }
    const bytes = this.sqliteStringToBytes(current);
    const results: (number | null)[] = [];
    let currentOverflow: 'WRAP' | 'SAT' | 'FAIL' = 'WRAP';

    for (const op of operations) {
      if (op.type !== 'GET' && op.overflow) currentOverflow = op.overflow;
      const isSigned = op.encoding.toLowerCase().startsWith('i');
      const bits = parseInt(op.encoding.slice(1));
      if (bits < 1 || bits > 64) throw new Error('ERR invalid bitfield encoding');
      const maxUnsigned = Math.pow(2, bits) - 1;
      const maxSigned = Math.pow(2, bits - 1) - 1;
      const minSigned = -Math.pow(2, bits - 1);

      const applyOverflow = (val: number): number | null => {
        if (isSigned) {
          if (val > maxSigned || val < minSigned) {
            if (currentOverflow === 'FAIL') return null;
            if (currentOverflow === 'SAT') return val > maxSigned ? maxSigned : val < minSigned ? minSigned : val;
            const range = Math.pow(2, bits);
            return ((val + Math.pow(2, bits - 1)) % range + range) % range - Math.pow(2, bits - 1);
          }
          return val;
        } else {
          if (val < 0 || val > maxUnsigned) {
            if (currentOverflow === 'FAIL') return null;
            if (currentOverflow === 'SAT') return val < 0 ? 0 : val > maxUnsigned ? maxUnsigned : val;
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
          if (byteIdx < bytes.length) val = (val << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
          else val = val << 1;
        }
        if (isSigned && val > maxSigned) val = val - Math.pow(2, bits);
        results.push(val);
      } else if (op.type === 'SET') {
        let oldVal = 0;
        for (let b = 0; b < bits; b++) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          if (byteIdx < bytes.length) oldVal = (oldVal << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
        }
        if (isSigned && oldVal > maxSigned) oldVal = oldVal - Math.pow(2, bits);
        const setValue = op.value!;
        let writeVal = isSigned ? (setValue < 0 ? setValue + Math.pow(2, bits) : setValue) : (setValue < 0 ? setValue + Math.pow(2, bits) : setValue);
        for (let b = bits - 1; b >= 0; b--) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          while (bytes.length <= byteIdx) bytes.push(0);
          const bit = (writeVal >> (bits - 1 - b)) & 1;
          if (bit === 1) bytes[byteIdx] |= (1 << bitIdx);
          else bytes[byteIdx] &= ~(1 << bitIdx);
        }
        results.push(oldVal);
      } else if (op.type === 'INCRBY') {
        let currentVal = 0;
        for (let b = 0; b < bits; b++) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          if (byteIdx < bytes.length) currentVal = (currentVal << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
        }
        if (isSigned && currentVal > maxSigned) currentVal = currentVal - Math.pow(2, bits);
        const increment = op.value!;
        const newVal = currentVal + increment;
        const clampedVal = applyOverflow(newVal);
        if (clampedVal === null) { results.push(null); continue; }
        let writeVal = isSigned ? (clampedVal < 0 ? clampedVal + Math.pow(2, bits) : clampedVal) : clampedVal;
        for (let b = bits - 1; b >= 0; b--) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          while (bytes.length <= byteIdx) bytes.push(0);
          const bit = (writeVal >> (bits - 1 - b)) & 1;
          if (bit === 1) bytes[byteIdx] |= (1 << bitIdx);
          else bytes[byteIdx] &= ~(1 << bitIdx);
        }
        results.push(clampedVal);
      }
    }
    const newValue = this.sqliteBytesToString(bytes);
    this.db.prepare('INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, \'string\', ?)').run(key, newValue, existingExpiresAt);
    return results;
  }

  async bitfieldRo(key: string, operations: Array<{ type: 'GET'; encoding: string; offset: number }>): Promise<(number | null)[]> {
    const opsWithOverflow: Array<{ type: 'GET' | 'SET' | 'INCRBY'; encoding: string; offset: number; value?: number; overflow?: 'WRAP' | 'SAT' | 'FAIL' }> = operations.map(op => ({ ...op, overflow: 'WRAP' as const }));
    return this.bitfield(key, opsWithOverflow);
  }

  // === HyperLogLog operations ===

  async pfadd(key: string, elements: string[]): Promise<number> {
    this.evictExpired(key);
    this.ensureHllTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    let registers: Uint8Array;
    let existingExpiresAt: number | null;
    if (!row) { registers = new Uint8Array(this.HLL_BYTES); existingExpiresAt = null; }
    else { registers = this.hllDecode(row.value); existingExpiresAt = row.expires_at; }
    let changed = false;
    for (const el of elements) {
      const hash = this.murmurHash64(el);
      const idx = this.hllIndex(hash);
      const rho = this.hllRho(hash);
      const currentVal = this.read6BitRegister(registers, idx);
      if (rho > currentVal) { this.write6BitRegister(registers, idx, rho); changed = true; }
    }
    if (changed || !row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'hyperloglog', ?)").run(key, this.hllEncode(registers), existingExpiresAt);
    }
    return changed ? 1 : 0;
  }

  async pfcount(keys: string[]): Promise<number> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this.ensureHllTypeOrThrow(key);
    if (keys.length === 0) return 0;
    if (keys.length === 1) {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(keys[0]) as { value: string } | undefined;
      if (!row) return 0;
      const registers = this.hllDecode(row.value);
      return this.hllEstimate(registers);
    }
    const merged = new Uint8Array(this.HLL_BYTES);
    for (const key of keys) {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      if (!row) continue;
      const registers = this.hllDecode(row.value);
      for (let i = 0; i < this.HLL_REGISTERS; i++) {
        const val = this.read6BitRegister(registers, i);
        const currentVal = this.read6BitRegister(merged, i);
        if (val > currentVal) this.write6BitRegister(merged, i, val);
      }
    }
    return this.hllEstimate(merged);
  }

  async pfmerge(destkey: string, sourceKeys: string[]): Promise<void> {
    this.evictExpired(destkey);
    for (const key of sourceKeys) this.evictExpired(key);
    for (const key of sourceKeys) this.ensureHllTypeOrThrow(key);
    this.ensureHllTypeOrThrow(destkey);
    const merged = new Uint8Array(this.HLL_BYTES);
    for (const key of sourceKeys) {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      if (!row) continue;
      const registers = this.hllDecode(row.value);
      for (let i = 0; i < this.HLL_REGISTERS; i++) {
        const val = this.read6BitRegister(registers, i);
        const currentVal = this.read6BitRegister(merged, i);
        if (val > currentVal) this.write6BitRegister(merged, i, val);
      }
    }
    this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'hyperloglog', NULL)").run(destkey, this.hllEncode(merged));
  }

  // === JSON operations ===

  async jsonSet(key: string, path: string, value: string, nx?: boolean, xx?: boolean): Promise<string | null> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    let parsedValue: any;
    try { parsedValue = JSON.parse(value); } catch { throw new Error('ERR invalid JSON'); }

    if (path === '$' || path === '') {
      if (nx && this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key)) return null;
      if (xx && !this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key)) return null;
      const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as { expires_at: number | null } | undefined;
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'json', ?)").run(key, JSON.stringify(parsedValue), row?.expires_at ?? null);
      return 'OK';
    }

    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) {
      if (xx) return null;
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'json', NULL)").run(key, JSON.stringify(parsedValue));
      return 'OK';
    }
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, path);
    if (resolved.length === 0) { if (xx) return null; return null; }
    if (nx && resolved.length > 0) return null;
    for (const r of resolved) { if (r.parent !== null) r.parent[r.key] = parsedValue; }
    this.db.prepare('INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, \'json\', ?)').run(key, JSON.stringify(root), row.expires_at);
    return 'OK';
  }

  async jsonGet(key: string, paths?: string[]): Promise<string | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return null;
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (typeRow && typeRow.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const root = JSON.parse(row.value);
    if (!paths || paths.length === 0) return row.value;
    if (paths.length === 1) {
      const resolved = this.sqliteJsonResolvePath(root, paths[0]);
      if (resolved.length === 0) return null;
      return JSON.stringify(resolved[0].value);
    }
    const result: Record<string, any> = {};
    for (const p of paths) {
      const resolved = this.sqliteJsonResolvePath(root, p);
      result[p] = resolved.length === 0 ? null : resolved[0].value;
    }
    return JSON.stringify(result);
  }

  async jsonDel(key: string, path?: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
    if (!row) return 0;
    if (row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    if (!path || path === '$') { this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key); return 1; }
    const fullRow = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!fullRow) return 0;
    let root = JSON.parse(fullRow.value);
    const resolved = this.sqliteJsonResolvePath(root, path);
    if (resolved.length === 0) return 0;
    let count = 0;
    for (let i = resolved.length - 1; i >= 0; i--) {
      const r = resolved[i];
      if (r.parent !== null) {
        if (Array.isArray(r.parent)) r.parent.splice(r.key as number, 1);
        else delete r.parent[r.key as string];
        count++;
      }
    }
    if (count > 0) this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    return count;
  }

  async jsonType(key: string, path?: string): Promise<string | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
    if (!row) return null;
    if (row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const root = JSON.parse(row.value);
    if (!path || path === '$') return this.sqliteJsonTypeOf(root);
    const resolved = this.sqliteJsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    return this.sqliteJsonTypeOf(resolved[0].value);
  }

  async jsonStrlen(key: string, path?: string): Promise<number | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
    if (!row) return null;
    if (row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const root = JSON.parse(row.value);
    const effectivePath = path || '$';
    const resolved = this.sqliteJsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    if (typeof resolved[0].value === 'string') return resolved[0].value.length;
    return null;
  }

  async jsonStrappend(key: string, path: string, value: string): Promise<number | null> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) throw new Error('ERR key not found');
    let root = JSON.parse(row.value);
    let appendString: string;
    try { appendString = JSON.parse(value); } catch { throw new Error('ERR invalid JSON'); }
    if (typeof appendString !== 'string') throw new Error('ERR value is not a string');
    const resolved = this.sqliteJsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    for (const r of resolved) {
      if (typeof r.value === 'string') {
        if (r.parent !== null) r.parent[r.key] = r.value + appendString;
        else root = root + appendString;
      }
    }
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    const newResolved = this.sqliteJsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'string') return newResolved[0].value.length;
    return null;
  }

  async jsonObjkeys(key: string, path?: string): Promise<string[] | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
    if (!row) return null;
    if (row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const root = JSON.parse(row.value);
    const effectivePath = path || '$';
    const resolved = this.sqliteJsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    const val = resolved[0].value;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) return Object.keys(val);
    return null;
  }

  async jsonObjlen(key: string, path?: string): Promise<number | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
    if (!row) return null;
    if (row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const root = JSON.parse(row.value);
    const effectivePath = path || '$';
    const resolved = this.sqliteJsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    const val = resolved[0].value;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) return Object.keys(val).length;
    return null;
  }

  async jsonArrappend(key: string, path: string, values: string[]): Promise<(number | null)[]> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) throw new Error('ERR key not found');
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, path);
    const results: (number | null)[] = [];
    const parsedValues: any[] = values.map(v => { try { return JSON.parse(v); } catch { return v; } });
    for (const r of resolved) {
      if (Array.isArray(r.value)) { r.value.push(...parsedValues); if (r.parent !== null) r.parent[r.key] = r.value; results.push(r.value.length); }
      else results.push(null);
    }
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    return results;
  }

  async jsonArrpop(key: string, path?: string, index?: number): Promise<string | null> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;
    const effectivePath = path || '$';
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    const r = resolved[0];
    if (!Array.isArray(r.value)) return null;
    const arr = r.value;
    let idx = index ?? -1;
    if (idx < 0) idx = arr.length + idx;
    if (idx < 0 || idx >= arr.length) return null;
    const popped = arr.splice(idx, 1)[0];
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    return JSON.stringify(popped);
  }

  async jsonArrlen(key: string, path?: string): Promise<number | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
    if (!row) return null;
    if (row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const root = JSON.parse(row.value);
    const effectivePath = path || '$';
    const resolved = this.sqliteJsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    if (Array.isArray(resolved[0].value)) return resolved[0].value.length;
    return null;
  }

  async jsonArrindex(key: string, path: string, value: string, start?: number, stop?: number): Promise<number | null> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return null;
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    if (!Array.isArray(resolved[0].value)) return null;
    let searchValue: any;
    try { searchValue = JSON.parse(value); } catch { searchValue = value; }
    const arr = resolved[0].value as any[];
    const s = start ?? 0, effectiveStop = stop ?? 0;
    for (let i = s; i < arr.length; i++) {
      if (effectiveStop > 0 && i > effectiveStop) break;
      if (JSON.stringify(arr[i]) === JSON.stringify(searchValue)) return i;
    }
    return -1;
  }

  async jsonArrinsert(key: string, path: string, index: number, values: string[]): Promise<(number | null)[]> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) throw new Error('ERR key not found');
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, path);
    const results: (number | null)[] = [];
    const parsedValues: any[] = values.map(v => { try { return JSON.parse(v); } catch { return v; } });
    for (const r of resolved) {
      if (Array.isArray(r.value)) { r.value.splice(index, 0, ...parsedValues); results.push(r.value.length); }
      else results.push(null);
    }
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    return results;
  }

  async jsonArrtrim(key: string, path: string, start: number, stop: number): Promise<number | null> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    const r = resolved[0];
    if (!Array.isArray(r.value)) return null;
    let s = start, e = stop;
    if (s < 0) s = r.value.length + s;
    if (e < 0) e = r.value.length + e;
    if (s < 0) s = 0;
    if (e >= r.value.length) e = r.value.length - 1;
    if (s > e) r.value.length = 0;
    else { r.value.splice(0, s); r.value.splice(e - s + 1); }
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    return r.value.length;
  }

  async jsonNumincrby(key: string, path: string, increment: number): Promise<string | null> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    for (const r of resolved) {
      if (typeof r.value === 'number') {
        const newVal = r.value + increment;
        if (r.parent !== null) r.parent[r.key] = newVal;
        else root = newVal;
      }
    }
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    const newResolved = this.sqliteJsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'number') return String(newResolved[0].value);
    return null;
  }

  async jsonNummultby(key: string, path: string, multiplier: number): Promise<string | null> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    for (const r of resolved) {
      if (typeof r.value === 'number') {
        const newVal = r.value * multiplier;
        if (r.parent !== null) r.parent[r.key] = newVal;
        else root = newVal;
      }
    }
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    const newResolved = this.sqliteJsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'number') return String(newResolved[0].value);
    return null;
  }

  async jsonMget(keys: string[], path: string): Promise<(string | null)[]> {
    const results: (string | null)[] = [];
    for (const key of keys) {
      this.evictExpired(key);
      const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
      if (!row || row.type !== 'json') { results.push(null); continue; }
      const root = JSON.parse(row.value);
      const resolved = this.sqliteJsonResolvePath(root, path);
      results.push(resolved.length === 0 ? null : JSON.stringify(resolved[0].value));
    }
    return results;
  }

  async jsonMset(pairs: Array<{ key: string; path: string; value: string }>): Promise<void> {
    for (const { key, path, value } of pairs) await this.jsonSet(key, path, value);
  }

  async jsonToggle(key: string, path?: string): Promise<string | null> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return null;
    const effectivePath = path || '$';
    let root = JSON.parse(row.value);
    const resolved = this.sqliteJsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    let result: string | null = null;
    for (const r of resolved) {
      if (typeof r.value === 'boolean') {
        const newVal = !r.value;
        if (r.parent !== null) r.parent[r.key] = newVal;
        else root = newVal;
        result = String(newVal);
      }
    }
    if (result !== null) this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    return result;
  }

  async jsonClear(key: string, path?: string): Promise<number> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) return 0;
    const effectivePath = path || '$';
    let root = JSON.parse(row.value);
    if (effectivePath === '$' || effectivePath === '') {
      if (Array.isArray(root)) root = [];
      else if (typeof root === 'object' && root !== null) root = {};
      else if (typeof root === 'string') root = '';
      else if (typeof root === 'number') root = 0;
      this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
      return 1;
    }
    const resolved = this.sqliteJsonResolvePath(root, effectivePath);
    let count = 0;
    for (const r of resolved) {
      if (Array.isArray(r.value)) { r.parent[r.key] = []; count++; }
      else if (typeof r.value === 'object' && r.value !== null) { r.parent[r.key] = {}; count++; }
      else if (typeof r.value === 'string') { r.parent[r.key] = ''; count++; }
      else if (typeof r.value === 'number') { r.parent[r.key] = 0; count++; }
    }
    if (count > 0) this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
    return count;
  }

  async jsonDebugMemory(key: string, path?: string): Promise<number | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
    if (!row) return null;
    if (row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const root = JSON.parse(row.value);
    const effectivePath = path || '$';
    if (effectivePath === '$' || effectivePath === '') return row.value.length;
    const resolved = this.sqliteJsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    return JSON.stringify(resolved[0].value).length;
  }

  async jsonResp(key: string, path?: string): Promise<string | null> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value, type FROM kv_store WHERE key = ?').get(key) as { value: string; type: string } | undefined;
    if (!row) return null;
    if (row.type !== 'json') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const root = JSON.parse(row.value);
    const effectivePath = path || '$';
    let val: any;
    if (effectivePath === '$' || effectivePath === '') val = root;
    else {
      const resolved = this.sqliteJsonResolvePath(root, effectivePath);
      if (resolved.length === 0) return null;
      val = resolved[0].value;
    }
    const serializeResp = (v: any): string => {
      if (v === null) return 'null';
      if (typeof v === 'boolean') return v ? '1' : '0';
      if (typeof v === 'number') { if (Number.isInteger(v)) return ':' + v; return '$' + v; }
      if (typeof v === 'string') return '$' + v.length + '\n' + v;
      if (Array.isArray(v)) return '*' + v.length + '\n' + v.map(serializeResp).join('\n');
      if (typeof v === 'object') {
        const keys = Object.keys(v);
        return '*' + (keys.length * 2) + '\n' + keys.flatMap(k => [serializeResp(k), serializeResp(v[k])]).join('\n');
      }
      return String(v);
    };
    return serializeResp(val);
  }

  async jsonMerge(key: string, path: string, value: string): Promise<void> {
    this.evictExpired(key);
    this.ensureJsonTypeOrThrow(key);
    let parsedValue: any;
    try { parsedValue = JSON.parse(value); } catch { throw new Error('ERR invalid JSON'); }
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'json', NULL)").run(key, JSON.stringify(parsedValue));
      return;
    }
    let root = JSON.parse(row.value);
    if (path === '$' || path === '') root = this.sqliteDeepMerge(root, parsedValue);
    else {
      const resolved = this.sqliteJsonResolvePath(root, path);
      for (const r of resolved) {
        if (r.parent !== null) r.parent[r.key] = this.sqliteDeepMerge(r.value, parsedValue);
        else root = this.sqliteDeepMerge(root, parsedValue);
      }
    }
    this.db.prepare('UPDATE kv_store SET value = ? WHERE key = ?').run(JSON.stringify(root), key);
  }



  // === Stream helpers ===

  private parseStreamId(id: string): { ms: number; seq: number } {
    if (id === '-' || id === '0-0') return { ms: 0, seq: 0 };
    const parts = id.split('-');
    return { ms: parseInt(parts[0], 10), seq: parseInt(parts[1], 10) };
  }

  private formatStreamId(ms: number, seq: number): string {
    return `${ ms}-${seq}`;
  }

  private compareStreamId(a: string, b: string): number {
    const pa = this.parseStreamId(a);
    const pb = this.parseStreamId(b);
    if (pa.ms !== pb.ms) return pa.ms - pb.ms;
    return pa.seq - pb.seq;
  }

  private generateStreamId(key: string, id: string): string | null {
    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as { last_id: string } | undefined;
    const lastId = metaRow ? metaRow.last_id : '0-0';

    if (id === '*') {
      const now = Date.now();
      const lastParsed = this.parseStreamId(lastId);
      if (now > lastParsed.ms) {
        return this.formatStreamId(now, 0);
      } else {
        return this.formatStreamId(lastParsed.ms, lastParsed.seq + 1);
      }
    }

    // Handle id with explicit ms and auto seq (e.g., "12345-*")
    if (id.endsWith('-*')) {
      const ms = parseInt(id.slice(0, -2), 10);
      const lastParsed = this.parseStreamId(lastId);
      if (ms > lastParsed.ms) {
        return this.formatStreamId(ms, 0);
      } else if (ms === lastParsed.ms) {
        return this.formatStreamId(ms, lastParsed.seq + 1);
      } else {
        return null;
      }
    }

    // Explicit id
    if (this.compareStreamId(id, lastId) <= 0) {
      return null;
    }
    return id;
  }

  private ensureStreamTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'stream') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  }

  private ensureStreamKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'stream') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'stream', NULL)").run(key);
    }
  }

  private cleanupStreamIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow || typeRow.type !== 'stream') return;
    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?').get(key) as { cnt: number };
    const grpCntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_groups WHERE key = ?').get(key) as { cnt: number };
    if (cntRow.cnt === 0 && grpCntRow.cnt === 0) {
      this.db.prepare('DELETE FROM stream_entries WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_meta WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_consumers WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_pending WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
  }

  // === Stream operations ===

  async xadd(key: string, id: string, fields: Record<string, string>, options?: { maxlen?: number; approx?: boolean; minid?: string; nomkstream?: boolean }): Promise<string | null> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    if (options?.nomkstream) {
      const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
      if (!row) return null;
    }

    this.ensureStreamKvStoreEntry(key);

    const generatedId = this.generateStreamId(key, id);
    if (generatedId === null) {
      throw new Error('ERR The ID specified in XADD is equal or smaller than the target stream top item');
    }

    const now = Date.now();
    const fieldsJson = JSON.stringify(fields);

    const tx = this.db.transaction(() => {
      // Insert entry
      this.db.prepare(
        'INSERT OR REPLACE INTO stream_entries (key, id, fields, created_at) VALUES (?, ?, ?, ?)'
      ).run(key, generatedId, fieldsJson, now);

      // Update stream metadata
      const metaRow = this.db.prepare('SELECT last_id, entries_added, recorded_first_id FROM stream_meta WHERE key = ?').get(key) as { last_id: string; entries_added: number; recorded_first_id: string } | undefined;
      if (metaRow) {
        this.db.prepare(
          'UPDATE stream_meta SET last_id = ?, entries_added = ? WHERE key = ?'
        ).run(generatedId, metaRow.entries_added + 1, key);
      } else {
        this.db.prepare(
          'INSERT OR REPLACE INTO stream_meta (key, last_id, max_deleted_id, entries_added, recorded_first_id) VALUES (?, ?, \'0-0\', 1, ?)'
        ).run(key, generatedId, generatedId);
      }

      // Handle trimming
      if (options?.maxlen !== undefined) {
        this.xtrimInternal(key, 'MAXLEN', options.maxlen, options.approx ?? false);
      } else if (options?.minid !== undefined) {
        this.xtrimInternal(key, 'MINID', options.minid, options.approx ?? false);
      }
    });

    tx();
    return generatedId;
  }

  private xtrimInternal(key: string, strategy: 'MAXLEN' | 'MINID', threshold: string | number, approx: boolean, limit?: number): number {
    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?').get(key) as { cnt: number };
    if (cntRow.cnt === 0) return 0;

    let removeCount = 0;

    if (strategy === 'MAXLEN') {
      const maxLen = typeof threshold === 'number' ? threshold : parseInt(String(threshold), 10);
      if (cntRow.cnt <= maxLen) return 0;
      removeCount = cntRow.cnt - maxLen;
      if (limit !== undefined && removeCount > limit) removeCount = limit;

      // Get the IDs to remove
      const rows = this.db.prepare(
        'SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT ?'
      ).all(key, removeCount) as { id: string }[];

      for (const row of rows) {
        this.db.prepare('DELETE FROM stream_entries WHERE key = ? AND id = ?').run(key, row.id);
      }

      // Update max_deleted_id and recorded_first_id
      if (rows.length > 0) {
        const metaRow = this.db.prepare('SELECT max_deleted_id, recorded_first_id FROM stream_meta WHERE key = ?').get(key) as { max_deleted_id: string; recorded_first_id: string } | undefined;
        if (metaRow) {
          const lastDeletedId = rows[rows.length - 1].id;
          const newMaxDeletedId = this.compareStreamId(metaRow.max_deleted_id, lastDeletedId) > 0 ? metaRow.max_deleted_id : lastDeletedId;
          this.db.prepare('UPDATE stream_meta SET max_deleted_id = ? WHERE key = ?').run(newMaxDeletedId, key);
          // Update recorded_first_id
          const firstRow = this.db.prepare('SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT 1').get(key) as { id: string } | undefined;
          if (firstRow) {
            this.db.prepare('UPDATE stream_meta SET recorded_first_id = ? WHERE key = ?').run(firstRow.id, key);
          }
        }
      }
    } else {
      // MINID strategy
      const minId = String(threshold);
      // Find entries with ID < minId
      const rows = this.db.prepare(
        'SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC'
      ).all(key) as { id: string }[];

      const toRemove: string[] = [];
      for (const row of rows) {
        if (this.compareStreamId(row.id, minId) < 0) {
          toRemove.push(row.id);
        } else {
          break;
        }
      }

      removeCount = toRemove.length;
      if (limit !== undefined && removeCount > limit) removeCount = limit;

      for (let i = 0; i < removeCount; i++) {
        this.db.prepare('DELETE FROM stream_entries WHERE key = ? AND id = ?').run(key, toRemove[i]);
      }

      // Update max_deleted_id and recorded_first_id
      if (removeCount > 0) {
        const metaRow = this.db.prepare('SELECT max_deleted_id FROM stream_meta WHERE key = ?').get(key) as { max_deleted_id: string } | undefined;
        if (metaRow) {
          const lastDeletedId = toRemove[removeCount - 1];
          const newMaxDeletedId = this.compareStreamId(metaRow.max_deleted_id, lastDeletedId) > 0 ? metaRow.max_deleted_id : lastDeletedId;
          this.db.prepare('UPDATE stream_meta SET max_deleted_id = ? WHERE key = ?').run(newMaxDeletedId, key);
        }
        const firstRow = this.db.prepare('SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT 1').get(key) as { id: string } | undefined;
        if (firstRow) {
          this.db.prepare('UPDATE stream_meta SET recorded_first_id = ? WHERE key = ?').run(firstRow.id, key);
        }
      }
    }

    return removeCount;
  }

  async xtrim(key: string, strategy: 'MAXLEN' | 'MINID', threshold: string | number, approx?: boolean, limit?: number): Promise<number> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    return this.xtrimInternal(key, strategy, threshold, approx ?? false, limit);
  }

  async xdel(key: string, ids: string[]): Promise<number> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    let removed = 0;
    const tx = this.db.transaction(() => {
      for (const id of ids) {
        const result = this.db.prepare('DELETE FROM stream_entries WHERE key = ? AND id = ?').run(key, id);
        if (result.changes > 0) {
          removed++;
          // Update max_deleted_id
          const metaRow = this.db.prepare('SELECT max_deleted_id FROM stream_meta WHERE key = ?').get(key) as { max_deleted_id: string } | undefined;
          if (metaRow && this.compareStreamId(id, metaRow.max_deleted_id) > 0) {
            this.db.prepare('UPDATE stream_meta SET max_deleted_id = ? WHERE key = ?').run(id, key);
          }
        }
      }
      // Update recorded_first_id
      const firstRow = this.db.prepare('SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT 1').get(key) as { id: string } | undefined;
      if (firstRow) {
        this.db.prepare('UPDATE stream_meta SET recorded_first_id = ? WHERE key = ?').run(firstRow.id, key);
      }
      this.cleanupStreamIfEmpty(key);
    });

    tx();
    return removed;
  }

  async xrange(key: string, start: string, end: string, count?: number): Promise<StreamEntry[]> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as { last_id: string } | undefined;
    if (!metaRow) return [];

    const startId = start === '-' ? '0-0' : start;
    const endId = end === '+' ? metaRow.last_id : end;

    let sql = 'SELECT id, fields, created_at FROM stream_entries WHERE key = ? AND id >= ? AND id <= ? ORDER BY id ASC';
    const params: any[] = [key, startId, endId];

    if (count !== undefined && count > 0) {
      sql += ' LIMIT ?';
      params.push(count);
    }

    const rows = this.db.prepare(sql).all(...params) as { id: string; fields: string; created_at: number }[];
    return rows.map(r => ({
      id: r.id,
      fields: JSON.parse(r.fields),
      createdAt: r.created_at,
    }));
  }

  async xrevrange(key: string, end: string, start: string, count?: number): Promise<StreamEntry[]> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as { last_id: string } | undefined;
    if (!metaRow) return [];

    const startId = start === '-' ? '0-0' : start;
    const endId = end === '+' ? metaRow.last_id : end;

    let sql = 'SELECT id, fields, created_at FROM stream_entries WHERE key = ? AND id >= ? AND id <= ? ORDER BY id DESC';
    const params: any[] = [key, startId, endId];

    if (count !== undefined && count > 0) {
      sql += ' LIMIT ?';
      params.push(count);
    }

    const rows = this.db.prepare(sql).all(...params) as { id: string; fields: string; created_at: number }[];
    return rows.map(r => ({
      id: r.id,
      fields: JSON.parse(r.fields),
      createdAt: r.created_at,
    }));
  }

  async xlen(key: string): Promise<number> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?').get(key) as { cnt: number };
    return row.cnt;
  }

  async xread(keys: string[], ids: string[], count?: number): Promise<Array<{ key: string; entries: StreamEntry[] }> | null> {
    for (let i = 0; i < keys.length; i++) {
      this.evictExpired(keys[i]);
    }
    for (const k of keys) this.ensureStreamTypeOrThrow(k);

    const results: Array<{ key: string; entries: StreamEntry[] }> = [];

    for (let i = 0; i < keys.length; i++) {
      const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(keys[i]) as { last_id: string } | undefined;
      if (!metaRow) continue;

      const startId = ids[i] === '$' ? metaRow.last_id : ids[i];

      let sql = 'SELECT id, fields, created_at FROM stream_entries WHERE key = ? AND id > ? ORDER BY id ASC';
      const params: any[] = [keys[i], startId];
      if (count !== undefined && count > 0) {
        sql += ' LIMIT ?';
        params.push(count);
      }

      const rows = this.db.prepare(sql).all(...params) as { id: string; fields: string; created_at: number }[];
      if (rows.length > 0) {
        results.push({
          key: keys[i],
          entries: rows.map(r => ({
            id: r.id,
            fields: JSON.parse(r.fields),
            createdAt: r.created_at,
          })),
        });
      }
    }

    return results.length > 0 ? results : null;
  }

  async xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    if (mkstream) {
      this.ensureStreamKvStoreEntry(key);
      // Ensure meta exists
      const metaRow = this.db.prepare('SELECT 1 FROM stream_meta WHERE key = ?').get(key);
      if (!metaRow) {
        this.db.prepare(
          'INSERT OR REPLACE INTO stream_meta (key, last_id, max_deleted_id, entries_added, recorded_first_id) VALUES (?, \'0-0\', \'0-0\', 0, \'0-0\')'
        ).run(key);
      }
    }

    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as { last_id: string } | undefined;
    if (!metaRow) {
      throw new Error('ERR no such key');
    }

    const existingGroup = this.db.prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?').get(key, group);
    if (existingGroup) {
      throw new Error('BUSYGROUP Consumer Group name already exists');
    }

    const lastDeliveredId = id === '$' ? metaRow.last_id : id;
    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?').get(key) as { cnt: number };

    this.db.prepare(
      'INSERT INTO stream_groups (key, group_name, last_delivered_id, entries_read) VALUES (?, ?, ?, ?)'
    ).run(key, group, lastDeliveredId, cntRow.cnt);

    return 'OK';
  }

  async xgroupDestroy(key: string, group: string): Promise<number> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    // Check if key exists as stream
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return 0;

    const result = this.db.prepare('DELETE FROM stream_groups WHERE key = ? AND group_name = ?').run(key, group);
    // Also delete consumers and pending for this group
    this.db.prepare('DELETE FROM stream_consumers WHERE key = ? AND group_name = ?').run(key, group);
    this.db.prepare('DELETE FROM stream_pending WHERE key = ? AND group_name = ?').run(key, group);

    return result.changes > 0 ? 1 : 0;
  }

  async xgroupCreateconsumer(key: string, group: string, consumer: string): Promise<number> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const grpRow = this.db.prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?').get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    const existing = this.db.prepare('SELECT 1 FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?').get(key, group, consumer);
    if (existing) return 0;

    this.db.prepare(
      'INSERT INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) VALUES (?, ?, ?, 0, 0, \'0-0\', 0, ?)'
    ).run(key, group, consumer, Date.now());
    return 1;
  }

  async xgroupDelconsumer(key: string, group: string, consumer: string): Promise<number> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const grpRow = this.db.prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?').get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    // Count pending entries for this consumer in this group
    const pendingCnt = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM stream_pending WHERE key = ? AND group_name = ? AND consumer_name = ?'
    ).get(key, group, consumer) as { cnt: number };

    // Delete consumer and their pending entries
    this.db.prepare('DELETE FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?').run(key, group, consumer);
    this.db.prepare('DELETE FROM stream_pending WHERE key = ? AND group_name = ? AND consumer_name = ?').run(key, group, consumer);

    return pendingCnt.cnt;
  }

  async xgroupSetid(key: string, group: string, id: string): Promise<string> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as { last_id: string } | undefined;
    if (!metaRow) throw new Error('ERR no such key');

    const grpRow = this.db.prepare('SELECT last_delivered_id FROM stream_groups WHERE key = ? AND group_name = ?').get(key, group) as { last_delivered_id: string } | undefined;
    if (!grpRow) throw new Error('ERR no such consumer group');

    const lastDeliveredId = id === '$' ? metaRow.last_id : id;
    this.db.prepare('UPDATE stream_groups SET last_delivered_id = ? WHERE key = ? AND group_name = ?').run(lastDeliveredId, key, group);
    return 'OK';
  }

  async xreadgroup(group: string, consumer: string, keys: string[], ids: string[], count?: number, noack?: boolean): Promise<Array<{ key: string; entries: StreamEntry[] }> | null> {
    for (let i = 0; i < keys.length; i++) {
      this.evictExpired(keys[i]);
    }
    for (const k of keys) this.ensureStreamTypeOrThrow(k);

    const results: Array<{ key: string; entries: StreamEntry[] }> = [];
    const now = Date.now();

    for (let i = 0; i < keys.length; i++) {
      const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(keys[i]) as { last_id: string } | undefined;
      if (!metaRow) continue;

      const grpRow = this.db.prepare('SELECT last_delivered_id, entries_read FROM stream_groups WHERE key = ? AND group_name = ?').get(keys[i], group) as { last_delivered_id: string; entries_read: number } | undefined;
      if (!grpRow) continue;

      // Ensure consumer exists
      const consumerRow = this.db.prepare('SELECT 1 FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?').get(keys[i], group, consumer);
      if (!consumerRow) {
        this.db.prepare(
          'INSERT INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) VALUES (?, ?, ?, 0, 0, \'0-0\', 0, ?)'
        ).run(keys[i], group, consumer, now);
      } else {
        this.db.prepare('UPDATE stream_consumers SET seen_time = ? WHERE key = ? AND group_name = ? AND consumer_name = ?').run(now, keys[i], group, consumer);
      }

      const idArg = ids[i];

      if (idArg === '>') {
        // New entries: deliver entries after the group's lastDeliveredId
        let sql = 'SELECT id, fields, created_at FROM stream_entries WHERE key = ? AND id > ? ORDER BY id ASC';
        const params: any[] = [keys[i], grpRow.last_delivered_id];
        if (count !== undefined && count > 0) {
          sql += ' LIMIT ?';
          params.push(count);
        }

        const rows = this.db.prepare(sql).all(...params) as { id: string; fields: string; created_at: number }[];
        const entries: StreamEntry[] = rows.map(r => ({
          id: r.id,
          fields: JSON.parse(r.fields),
          createdAt: r.created_at,
        }));

        // Mark as pending
        if (!noack) {
          for (const entry of entries) {
            this.db.prepare(
              'INSERT OR REPLACE INTO stream_pending (key, id, group_name, consumer_name, delivered_time, delivery_count, last_delivered_time) VALUES (?, ?, ?, ?, ?, 1, ?)'
            ).run(keys[i], entry.id, group, consumer, now, now);
          }
        }

        // Update consumer pending count
        if (entries.length > 0) {
          this.db.prepare(
            'UPDATE stream_consumers SET pending_count = pending_count + ?, last_delivered_id = ? WHERE key = ? AND group_name = ? AND consumer_name = ?'
          ).run(entries.length, entries[entries.length - 1].id, keys[i], group, consumer);

          // Update group's lastDeliveredId
          this.db.prepare(
            'UPDATE stream_groups SET last_delivered_id = ?, entries_read = entries_read + ? WHERE key = ? AND group_name = ?'
          ).run(entries[entries.length - 1].id, entries.length, keys[i], group);
        }

        if (entries.length > 0) {
          results.push({ key: keys[i], entries });
        }
      } else {
        // Pending entries for this consumer: deliver entries with id > specified id
        const startId = idArg === '0' ? '0-0' : idArg;
        let sql = 'SELECT sp.id, se.fields, se.created_at FROM stream_pending sp LEFT JOIN stream_entries se ON sp.key = se.key AND sp.id = se.id WHERE sp.key = ? AND sp.group_name = ? AND sp.consumer_name = ? AND sp.id > ? ORDER BY sp.id ASC';
        const params: any[] = [keys[i], group, consumer, startId];
        if (count !== undefined && count > 0) {
          sql += ' LIMIT ?';
          params.push(count);
        }

        const rows = this.db.prepare(sql).all(...params) as { id: string; fields: string | null; created_at: number | null }[];
        const entries: StreamEntry[] = [];
        for (const r of rows) {
          if (r.fields !== null) {
            entries.push({
              id: r.id,
              fields: JSON.parse(r.fields),
              createdAt: r.created_at ?? 0,
            });
          }
        }

        if (entries.length > 0) {
          this.db.prepare('UPDATE stream_consumers SET last_delivered_id = ? WHERE key = ? AND group_name = ? AND consumer_name = ?').run(
            entries[entries.length - 1].id, keys[i], group, consumer
          );
          results.push({ key: keys[i], entries });
        }
      }
    }

    return results.length > 0 ? results : null;
  }

  async xack(key: string, group: string, ids: string[]): Promise<number> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    let acknowledged = 0;
    const tx = this.db.transaction(() => {
      for (const id of ids) {
        const row = this.db.prepare(
          'SELECT consumer_name FROM stream_pending WHERE key = ? AND group_name = ? AND id = ?'
        ).get(key, group, id) as { consumer_name: string } | undefined;

        if (row) {
          this.db.prepare(
            'DELETE FROM stream_pending WHERE key = ? AND group_name = ? AND id = ?'
          ).run(key, group, id);

          // Decrement consumer's pending count
          this.db.prepare(
            'UPDATE stream_consumers SET pending_count = MAX(0, pending_count - 1) WHERE key = ? AND group_name = ? AND consumer_name = ?'
          ).run(key, group, row.consumer_name);

          acknowledged++;
        }
      }
    });
    tx();
    return acknowledged;
  }

  async xpending(key: string, group: string, options?: { start?: string; end?: string; count?: number; consumer?: string; idle?: number }): Promise<PendingEntry[] | { count: number; minId: string | null; maxId: string | null; consumers: Array<{ name: string; pending: number }> }> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const grpRow = this.db.prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?').get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    if (options?.start !== undefined || options?.end !== undefined || options?.idle !== undefined) {
      // Detailed mode
      let sql = 'SELECT id, consumer_name, group_name, delivered_time, delivery_count, last_delivered_time FROM stream_pending WHERE key = ? AND group_name = ?';
      const params: any[] = [key, group];

      // Filter by idle time
      if (options?.idle !== undefined) {
        sql += ' AND (? - delivered_time) > ?';
        params.push(Date.now(), options.idle);
      }

      // Filter by ID range
      if (options?.start !== undefined && options?.end !== undefined) {
        const startId = options.start === '-' ? '0-0' : options.start;
        const endId = options.end === '+' ? '9999999999999-9999' : options.end;
        sql += ' AND id >= ? AND id <= ?';
        params.push(startId, endId);
      }

      // Filter by consumer
      if (options?.consumer) {
        sql += ' AND consumer_name = ?';
        params.push(options.consumer);
      }

      sql += ' ORDER BY id ASC';

      if (options?.count !== undefined) {
        sql += ' LIMIT ?';
        params.push(options.count);
      }

      const rows = this.db.prepare(sql).all(...params) as { id: string; consumer_name: string; group_name: string; delivered_time: number; delivery_count: number; last_delivered_time: number }[];
      return rows.map(r => ({
        id: r.id,
        consumer: r.consumer_name,
        group: r.group_name,
        deliveredTime: r.delivered_time,
        deliveryCount: r.delivery_count,
        lastDeliveredTime: r.last_delivered_time,
      }));
    }

    // Summary mode
    const cntRow = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM stream_pending WHERE key = ? AND group_name = ?'
    ).get(key, group) as { cnt: number };

    const minRow = this.db.prepare(
      'SELECT MIN(id) as min_id FROM stream_pending WHERE key = ? AND group_name = ?'
    ).get(key, group) as { min_id: string | null };

    const maxRow = this.db.prepare(
      'SELECT MAX(id) as max_id FROM stream_pending WHERE key = ? AND group_name = ?'
    ).get(key, group) as { max_id: string | null };

    const consumerRows = this.db.prepare(
      'SELECT consumer_name, COUNT(*) as pending FROM stream_pending WHERE key = ? AND group_name = ? GROUP BY consumer_name'
    ).all(key, group) as { consumer_name: string; pending: number }[];

    return {
      count: cntRow.cnt,
      minId: minRow.min_id,
      maxId: maxRow.max_id,
      consumers: consumerRows.map(r => ({ name: r.consumer_name, pending: r.pending })),
    };
  }

  async xclaim(key: string, group: string, consumer: string, minIdleTime: number, ids: string[], options?: { idle?: number; time?: number; retrycount?: number; force?: boolean; justid?: boolean }): Promise<StreamEntry[] | string[]> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const grpRow = this.db.prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?').get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    const now = Date.now();
    const entries: StreamEntry[] = [];
    const claimedIds: string[] = [];

    // Ensure new consumer exists
    const consumerRow = this.db.prepare('SELECT 1 FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?').get(key, group, consumer);
    if (!consumerRow) {
      this.db.prepare(
        'INSERT INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) VALUES (?, ?, ?, 0, 0, \'0-0\', 0, ?)'
      ).run(key, group, consumer, now);
    }

    const tx = this.db.transaction(() => {
      for (const id of ids) {
        const pendingRow = this.db.prepare(
          'SELECT consumer_name, delivered_time, delivery_count FROM stream_pending WHERE key = ? AND group_name = ? AND id = ?'
        ).get(key, group, id) as { consumer_name: string; delivered_time: number; delivery_count: number } | undefined;

        if (!pendingRow) {
          if (options?.force) {
            // Force create pending entry
            const entryRow = this.db.prepare(
              'SELECT fields, created_at FROM stream_entries WHERE key = ? AND id = ?'
            ).get(key, id) as { fields: string; created_at: number } | undefined;
            if (entryRow) {
              this.db.prepare(
                'INSERT OR REPLACE INTO stream_pending (key, id, group_name, consumer_name, delivered_time, delivery_count, last_delivered_time) VALUES (?, ?, ?, ?, ?, 1, ?)'
              ).run(key, id, group, consumer, options?.time ?? now, options?.time ?? now);
              this.db.prepare(
                'UPDATE stream_consumers SET pending_count = pending_count + 1 WHERE key = ? AND group_name = ? AND consumer_name = ?'
              ).run(key, group, consumer);
              entries.push({ id, fields: JSON.parse(entryRow.fields), createdAt: entryRow.created_at });
              claimedIds.push(id);
            }
          }
          continue;
        }

        const idleTime = now - pendingRow.delivered_time;
        if (idleTime < minIdleTime) continue;

        // Transfer from old consumer to new
        this.db.prepare(
          'UPDATE stream_consumers SET pending_count = MAX(0, pending_count - 1) WHERE key = ? AND group_name = ? AND consumer_name = ?'
        ).run(key, group, pendingRow.consumer_name);

        // Update pending entry
        const deliveryCount = options?.retrycount ?? pendingRow.delivery_count + 1;
        const deliveredTime = options?.idle !== undefined ? now - options.idle : options?.time ?? now;

        this.db.prepare(
          'UPDATE stream_pending SET consumer_name = ?, delivered_time = ?, delivery_count = ?, last_delivered_time = ? WHERE key = ? AND group_name = ? AND id = ?'
        ).run(consumer, deliveredTime, deliveryCount, deliveredTime, key, group, id);

        this.db.prepare(
          'UPDATE stream_consumers SET pending_count = pending_count + 1, seen_time = ? WHERE key = ? AND group_name = ? AND consumer_name = ?'
        ).run(now, key, group, consumer);

        const entryRow = this.db.prepare(
          'SELECT fields, created_at FROM stream_entries WHERE key = ? AND id = ?'
        ).get(key, id) as { fields: string; created_at: number } | undefined;
        if (entryRow) {
          entries.push({ id, fields: JSON.parse(entryRow.fields), createdAt: entryRow.created_at });
        }
        claimedIds.push(id);
      }
    });
    tx();

    if (options?.justid) return claimedIds;
    return entries;
  }

  async xautoclaim(key: string, group: string, consumer: string, minIdleTime: number, start: string, options?: { count?: number; justid?: boolean }): Promise<{ nextStartId: string; entries: StreamEntry[] | string[] }> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const grpRow = this.db.prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?').get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    const now = Date.now();
    const startId = start === '-' ? '0-0' : start;
    const effectiveCount = options?.count ?? 100;

    // Ensure new consumer exists
    const consumerRow = this.db.prepare('SELECT 1 FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?').get(key, group, consumer);
    if (!consumerRow) {
      this.db.prepare(
        'INSERT INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) VALUES (?, ?, ?, 0, 0, \'0-0\', 0, ?)'
      ).run(key, group, consumer, now);
    }

    // Get pending entries that match idle time and start criteria
    const pendingRows = this.db.prepare(
      'SELECT id, consumer_name, delivered_time, delivery_count FROM stream_pending WHERE key = ? AND group_name = ? AND id >= ? ORDER BY id ASC'
    ).all(key, group, startId) as { id: string; consumer_name: string; delivered_time: number; delivery_count: number }[];

    const claimedEntries: StreamEntry[] = [];
    const claimedIds: string[] = [];
    let nextStartId = '0-0';

    const tx = this.db.transaction(() => {
      let count = 0;
      for (const row of pendingRows) {
        if (count >= effectiveCount) {
          nextStartId = row.id;
          break;
        }

        const idleTime = now - row.delivered_time;
        if (idleTime >= minIdleTime) {
          // Transfer to new consumer
          this.db.prepare(
            'UPDATE stream_consumers SET pending_count = MAX(0, pending_count - 1) WHERE key = ? AND group_name = ? AND consumer_name = ?'
          ).run(key, group, row.consumer_name);

          this.db.prepare(
            'UPDATE stream_pending SET consumer_name = ?, delivered_time = ?, delivery_count = delivery_count + 1, last_delivered_time = ? WHERE key = ? AND group_name = ? AND id = ?'
          ).run(consumer, now, now, key, group, row.id);

          this.db.prepare(
            'UPDATE stream_consumers SET pending_count = pending_count + 1, seen_time = ? WHERE key = ? AND group_name = ? AND consumer_name = ?'
          ).run(now, key, group, consumer);

          const entryRow = this.db.prepare(
            'SELECT fields, created_at FROM stream_entries WHERE key = ? AND id = ?'
          ).get(key, row.id) as { fields: string; created_at: number } | undefined;
          if (entryRow) {
            claimedEntries.push({ id: row.id, fields: JSON.parse(entryRow.fields), createdAt: entryRow.created_at });
          }
          claimedIds.push(row.id);
          count++;
        }
      }
    });
    tx();

    return {
      nextStartId,
      entries: options?.justid ? claimedIds : claimedEntries,
    };
  }

  async xinfoStream(key: string): Promise<StreamInfo> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT last_id, max_deleted_id, entries_added, recorded_first_id FROM stream_meta WHERE key = ?').get(key) as { last_id: string; max_deleted_id: string; entries_added: number; recorded_first_id: string } | undefined;
    if (!metaRow) throw new Error('ERR no such key');

    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?').get(key) as { cnt: number };
    const firstRow = this.db.prepare('SELECT id, fields, created_at FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT 1').get(key) as { id: string; fields: string; created_at: number } | undefined;
    const lastRow = this.db.prepare('SELECT id, fields, created_at FROM stream_entries WHERE key = ? ORDER BY id DESC LIMIT 1').get(key) as { id: string; fields: string; created_at: number } | undefined;
    const grpCntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_groups WHERE key = ?').get(key) as { cnt: number };

    const firstEntry = firstRow ? { id: firstRow.id, fields: JSON.parse(firstRow.fields), createdAt: firstRow.created_at } : null;
    const lastEntry = lastRow ? { id: lastRow.id, fields: JSON.parse(lastRow.fields), createdAt: lastRow.created_at } : null;

    return {
      length: cntRow.cnt,
      firstEntry,
      lastEntry,
      maxDeletedEntryId: metaRow.max_deleted_id,
      entriesAdded: metaRow.entries_added,
      recordedFirstEntryId: metaRow.recorded_first_id,
      groups: grpCntRow.cnt,
    };
  }

  async xinfoGroups(key: string): Promise<GroupInfo[]> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT 1 FROM stream_meta WHERE key = ?').get(key);
    if (!metaRow) throw new Error('ERR no such key');

    const groups = this.db.prepare('SELECT group_name, last_delivered_id, entries_read FROM stream_groups WHERE key = ?').all(key) as { group_name: string; last_delivered_id: string; entries_read: number }[];
    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?').get(key) as { cnt: number };

    const result: GroupInfo[] = [];
    for (const grp of groups) {
      const consumerCnt = this.db.prepare('SELECT COUNT(DISTINCT consumer_name) as cnt FROM stream_consumers WHERE key = ? AND group_name = ?').get(key, grp.group_name) as { cnt: number };
      const pendingCnt = this.db.prepare('SELECT COUNT(*) as cnt FROM stream_pending WHERE key = ? AND group_name = ?').get(key, grp.group_name) as { cnt: number };
      result.push({
        name: grp.group_name,
        consumers: consumerCnt.cnt,
        pending: pendingCnt.cnt,
        lastDeliveredId: grp.last_delivered_id,
        entriesRead: grp.entries_read,
        lag: cntRow.cnt - grp.entries_read,
      });
    }
    return result;
  }

  async xinfoConsumers(key: string, group: string): Promise<StreamConsumer[]> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const grpRow = this.db.prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?').get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    const consumers = this.db.prepare(
      'SELECT consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time FROM stream_consumers WHERE key = ? AND group_name = ?'
    ).all(key, group) as { consumer_name: string; pending_count: number; idle_time: number; last_delivered_id: string; last_ack_time: number; seen_time: number }[];

    const now = Date.now();
    return consumers.map(c => ({
      name: c.consumer_name,
      pendingCount: c.pending_count,
      idleTime: now - c.seen_time,
      lastDeliveredId: c.last_delivered_id,
      lastAckTime: c.last_ack_time,
    }));
  }

  async xsetid(key: string, id: string): Promise<string> {
    this.evictExpired(key);
    this.ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT 1 FROM stream_meta WHERE key = ?').get(key);
    if (!metaRow) throw new Error('ERR no such key');

    this.db.prepare('UPDATE stream_meta SET last_id = ? WHERE key = ?').run(id, key);
    return 'OK';
  }

  // === Geospatial operations (stubs — not yet implemented for SQLite) ===

  async geoadd(key: string, members: Array<{ longitude: number; latitude: number; member: string }>, options?: { nx?: boolean; xx?: boolean; ch?: boolean }): Promise<number> {
    throw new Error('Not implemented');
  }
  async geohash(key: string, members: string[]): Promise<(string | null)[]> {
    throw new Error('Not implemented');
  }
  async geopos(key: string, members: string[]): Promise<(Array<number> | null)[]> {
    throw new Error('Not implemented');
  }
  async geodist(key: string, member1: string, member2: string, unit?: 'm' | 'km' | 'ft' | 'mi'): Promise<number | null> {
    throw new Error('Not implemented');
  }
  async georadius(key: string, longitude: number, latitude: number, radius: number, unit: 'm' | 'km' | 'ft' | 'mi', options?: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string }): Promise<GeoSearchResult[]> {
    throw new Error('Not implemented');
  }
  async georadiusbymember(key: string, member: string, radius: number, unit: 'm' | 'km' | 'ft' | 'mi', options?: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string }): Promise<GeoSearchResult[]> {
    throw new Error('Not implemented');
  }
  async geosearch(key: string, options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; withCoord?: boolean; withDist?: boolean; withHash?: boolean }): Promise<GeoSearchResult[]> {
    throw new Error('Not implemented');
  }
  async geosearchstore(destination: string, source: string, options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; storeDist?: boolean }): Promise<number> {
    throw new Error('Not implemented');
  }

  // === Server / Persistence ===

  async save(): Promise<void> {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.lastSaveTime = Math.floor(Date.now() / 1000);
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

    // Memory section — estimate using page_count * page_size
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    const usedMemory = pageCount * pageSize;
    const usedMemoryHuman = formatMemoryHuman(usedMemory);
    sections['memory'] =
      '# Memory\r\n' +
      'used_memory:' + usedMemory + '\r\n' +
      'used_memory_human:' + usedMemoryHuman + '\r\n';

    // Persistence section
    sections['persistence'] =
      '# Persistence\r\n' +
      'loading:0\r\n' +
      'rdb_last_save_time:' + this.lastSaveTime + '\r\n';

    // Keyspace section
    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM kv_store').get() as { cnt: number };
    sections['keyspace'] =
      '# Keyspace\r\n' +
      'db0:keys=' + cntRow.cnt + ',expires=0\r\n';

    if (section && section !== 'all') {
      return sections[section] ?? '';
    }
    // Return all sections
    return sections['server'] + sections['clients'] + sections['memory'] + sections['persistence'] + sections['keyspace'];
  }

  async getLastSaveTime(): Promise<number> {
    return this.lastSaveTime;
  }
}