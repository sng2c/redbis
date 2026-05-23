// @ts-nocheck
export const expireMethods = {
  async expire(key: string, seconds: number): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (!row) return false;
    this.db
      .prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?')
      .run(Date.now() + seconds * 1000, key);
    return true;
  },

  async expireat(key: string, timestamp: number): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (!row) return false;
    this.db.prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?').run(timestamp * 1000, key);
    return true;
  },

  async pexpire(key: string, milliseconds: number): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (!row) return false;
    this.db
      .prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?')
      .run(Date.now() + milliseconds, key);
    return true;
  },

  async pexpireat(key: string, millisecondsTimestamp: number): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
    if (!row) return false;
    this.db
      .prepare('UPDATE kv_store SET expires_at = ? WHERE key = ?')
      .run(millisecondsTimestamp, key);
    return true;
  },

  async ttl(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as
      | { expires_at: number | null }
      | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;
    const remaining = Math.ceil((row.expires_at - Date.now()) / 1000);
    if (remaining <= 0) {
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
      return -2;
    }
    return remaining;
  },

  async pttl(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as
      | { expires_at: number | null }
      | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;
    const remaining = row.expires_at - Date.now();
    if (remaining <= 0) {
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
      return -2;
    }
    return remaining;
  },

  async persist(key: string): Promise<boolean> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as
      | { expires_at: number | null }
      | undefined;
    if (!row) return false;
    if (row.expires_at === null) return false;
    this.db.prepare('UPDATE kv_store SET expires_at = NULL WHERE key = ?').run(key);
    return true;
  },

  async expiretime(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as
      | { expires_at: number | null }
      | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;
    return Math.floor(row.expires_at / 1000);
  },

  async pexpiretime(key: string): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT expires_at FROM kv_store WHERE key = ?').get(key) as
      | { expires_at: number | null }
      | undefined;
    if (!row) return -2;
    if (row.expires_at === null) return -1;
    return row.expires_at;
  },
};