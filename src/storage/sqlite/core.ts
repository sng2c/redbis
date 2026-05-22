// SqliteStorage core — database setup, shared helpers, and core key-value methods.
// Data-type methods are added via mixins (see index.ts).

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { StorageConfig } from '../interface';
import { formatMemoryHuman, globToRegex } from './types';

export class SqliteStorage {
  db!: Database.Database;
  startTime = Date.now();
  lastSaveTime: number = 0;

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

migrate(): void {
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

    // Geo table
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS geo_store (key TEXT NOT NULL, member TEXT NOT NULL, longitude REAL NOT NULL, latitude REAL NOT NULL, PRIMARY KEY (key, member))'
    ).run();
    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_geo_store_key ON geo_store(key)'
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

evictExpired(key: string): void {
    const result = this.db.prepare(
      "DELETE FROM kv_store WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?"
    ).run(key, Date.now());
    if (result.changes > 0) {
      this.db.prepare('DELETE FROM hash_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM geo_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_entries WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_meta WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_groups WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_consumers WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_pending WHERE key = ?').run(key);
    }
  }

evictAllExpired(): void {
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
      "DELETE FROM geo_store WHERE key IN (SELECT key FROM kv_store WHERE type = 'zset' AND expires_at IS NOT NULL AND expires_at <= ?)"
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
    this.db.prepare('DELETE FROM geo_store WHERE key = ?').run(key);
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
    this.db.prepare('DELETE FROM geo_store').run();
    this.db.prepare('DELETE FROM stream_entries').run();
    this.db.prepare('DELETE FROM stream_meta').run();
    this.db.prepare('DELETE FROM stream_groups').run();
    this.db.prepare('DELETE FROM stream_consumers').run();
    this.db.prepare('DELETE FROM stream_pending').run();
  }

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
      this.db.prepare('UPDATE geo_store SET key = ? WHERE key = ?').run(newKey, oldKey);
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
      this.db.prepare(
        'INSERT OR REPLACE INTO geo_store (key, member, longitude, latitude) SELECT ?, member, longitude, latitude FROM geo_store WHERE key = ?'
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
      `DELETE FROM geo_store WHERE key IN (${placeholders})`
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

}
