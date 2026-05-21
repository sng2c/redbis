import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { IStorage, StorageConfig } from './interface';

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
  }

  async get(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(key, value);
  }

  async delete(key: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    return result.changes > 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const likePattern = this.globToLike(pattern);
    const rows = this.db.prepare("SELECT key FROM kv_store WHERE key LIKE ? ESCAPE '\\'").all(likePattern) as { key: string }[];
    return rows.map(row => row.key).sort();
  }

  async flush(): Promise<void> {
    this.db.prepare('DELETE FROM kv_store').run();
  }

  private globToLike(pattern: string): string {
    let result = '';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === '*') {
        result += '%';
      } else if (ch === '?') {
        result += '_';
      } else if (ch === '%' || ch === '_' || ch === '\\') {
        result += '\\' + ch;
      } else {
        result += ch;
      }
    }
    return result;
  }
}