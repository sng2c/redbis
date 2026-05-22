// @ts-nocheck
import type { SqliteStorage } from './core';

export const listMethods = {
_ensureListKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'list', NULL)").run(key);
    }
  },

_ensureListTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'list') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  },

_cleanupListIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow || typeRow.type !== 'list') return;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
    if (row.cnt === 0) {
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
    }
  },

async lpush(key: string, elements: string[]): Promise<number> {
    this.evictExpired(key);
    this._ensureListTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      this._ensureListKvStoreEntry(key);
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
  },

async rpush(key: string, elements: string[]): Promise<number> {
    this.evictExpired(key);
    this._ensureListTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      this._ensureListKvStoreEntry(key);
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
  },

async lpop(key: string, count?: number): Promise<string | string[] | null> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return null;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      if (count === undefined || count === 1) {
        const row = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT 1').get(key) as { value: string } | undefined;
        if (!row) {
          this._cleanupListIfEmpty(key);
          return null;
        }
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = (SELECT seq FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT 1)').run(key, key);
        this._cleanupListIfEmpty(key);
        return row.value as string | string[] | null;
      }
      const rows = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT ?').all(key, count) as { value: string }[];
      if (rows.length === 0) {
        this._cleanupListIfEmpty(key);
        return null;
      }
      for (const row of rows) {
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND value = ? AND seq = (SELECT seq FROM list_store WHERE key = ? AND value = ? ORDER BY seq ASC LIMIT 1)').run(key, row.value, key, row.value);
      }
      this._cleanupListIfEmpty(key);
      return rows.map(r => r.value) as string | string[] | null;
    });
    const result = tx();
    if (count === undefined || count === 1) {
      return result as string | null;
    }
    return result as string[] | null;
  },

async rpop(key: string, count?: number): Promise<string | string[] | null> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return null;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      if (count === undefined || count === 1) {
        const row = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT 1').get(key) as { value: string } | undefined;
        if (!row) {
          this._cleanupListIfEmpty(key);
          return null;
        }
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = (SELECT seq FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT 1)').run(key, key);
        this._cleanupListIfEmpty(key);
        return row.value;
      }
      const rows = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT ?').all(key, count) as { value: string }[];
      if (rows.length === 0) {
        this._cleanupListIfEmpty(key);
        return null;
      }
      for (const row of rows) {
        this.db.prepare('DELETE FROM list_store WHERE key = ? AND value = ? AND seq = (SELECT seq FROM list_store WHERE key = ? AND value = ? ORDER BY seq DESC LIMIT 1)').run(key, row.value, key, row.value);
      }
      this._cleanupListIfEmpty(key);
      return rows.map(r => r.value);
    });
    const result = tx();
    if (count === undefined || count === 1) {
      return result as string | null;
    }
    return result as string[] | null;
  },

async llen(key: string): Promise<number> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return 0;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
    return row.cnt;
  },

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
  },

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
  },

async lset(key: string, index: number, element: string): Promise<void> {
    this.evictExpired(key);
    this._ensureListTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      this._ensureListKvStoreEntry(key);
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
  },

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
      this._cleanupListIfEmpty(key);
      return removed;
    });
    return tx();
  },

async ltrim(key: string, start: number, stop: number): Promise<void> {
    this.evictExpired(key);
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow) return;
    if (typeRow.type !== 'list') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

    const tx = this.db.transaction(() => {
      const lenRow = this.db.prepare('SELECT COUNT(*) as cnt FROM list_store WHERE key = ?').get(key) as { cnt: number };
      const len = lenRow.cnt;
      if (len === 0) {
        this._cleanupListIfEmpty(key);
        return;
      }
      let s = start;
      let e = stop;
      if (s < 0) s = Math.max(len + s, 0);
      if (e < 0) e = len + e;
      if (s > e || s >= len) {
        this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
        this._cleanupListIfEmpty(key);
        return;
      }
      if (e >= len) e = len - 1;
      // Get the seq range to keep
      const keepSeqs = this.db.prepare('SELECT seq FROM list_store WHERE key = ? ORDER BY seq ASC LIMIT ? OFFSET ?').all(key, e - s + 1, s) as { seq: number }[];
      if (keepSeqs.length === 0) {
        this.db.prepare('DELETE FROM list_store WHERE key = ?').run(key);
        this._cleanupListIfEmpty(key);
        return;
      }
      const placeholders = keepSeqs.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM list_store WHERE key = ? AND seq NOT IN (${placeholders})`).run(key, ...keepSeqs.map(r => r.seq));
      this._cleanupListIfEmpty(key);
    });
    tx();
  },

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
  },

async rpoplpush(source: string, destination: string): Promise<string | null> {
    this.evictExpired(source);
    this.evictExpired(destination);
    this._ensureListTypeOrThrow(source);
    this._ensureListTypeOrThrow(destination);

    const tx = this.db.transaction(() => {
      const srcRow = this.db.prepare('SELECT seq, value FROM list_store WHERE key = ? ORDER BY seq DESC LIMIT 1').get(source) as { seq: number; value: string } | undefined;
      if (!srcRow) return null;
      // Remove from source
      this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(source, srcRow.seq);
      // Push to destination (left)
      this._ensureListKvStoreEntry(destination);
      const minSeqRow = this.db.prepare('SELECT MIN(seq) as minSeq FROM list_store WHERE key = ?').get(destination) as { minSeq: number | null };
      const destSeq = minSeqRow.minSeq !== null ? minSeqRow.minSeq - 1 : 0;
      this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(destination, destSeq, srcRow.value);
      this._cleanupListIfEmpty(source);
      return srcRow.value;
    });
    return tx();
  },

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
  },

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
  },

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
  },

async lmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT'): Promise<string | null> {
    this.evictExpired(source);
    this.evictExpired(destination);
    this._ensureListTypeOrThrow(source);
    this._ensureListTypeOrThrow(destination);

    const tx = this.db.transaction(() => {
      // Pop from source
      const orderClause = srcDir === 'LEFT' ? 'ASC' : 'DESC';
      const srcRow = this.db.prepare(`SELECT seq, value FROM list_store WHERE key = ? ORDER BY seq ${orderClause} LIMIT 1`).get(source) as { seq: number; value: string } | undefined;
      if (!srcRow) return null;
      this.db.prepare('DELETE FROM list_store WHERE key = ? AND seq = ?').run(source, srcRow.seq);

      // Push to destination
      this._ensureListKvStoreEntry(destination);
      if (destDir === 'LEFT') {
        const minSeqRow = this.db.prepare('SELECT MIN(seq) as minSeq FROM list_store WHERE key = ?').get(destination) as { minSeq: number | null };
        const destSeq = minSeqRow.minSeq !== null ? minSeqRow.minSeq - 1 : 0;
        this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(destination, destSeq, srcRow.value);
      } else {
        const maxSeqRow = this.db.prepare('SELECT MAX(seq) as maxSeq FROM list_store WHERE key = ?').get(destination) as { maxSeq: number | null };
        const destSeq = maxSeqRow.maxSeq !== null ? maxSeqRow.maxSeq + 1 : 1;
        this.db.prepare('INSERT INTO list_store (key, seq, value) VALUES (?, ?, ?)').run(destination, destSeq, srcRow.value);
      }
      this._cleanupListIfEmpty(source);
      return srcRow.value;
    });
    return tx();
  },

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
        this._cleanupListIfEmpty(key);
        return { key, element: row.value };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  },

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
        this._cleanupListIfEmpty(key);
        return { key, element: row.value };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  },

async brpoplpush(source: string, destination: string, timeout: number): Promise<string | null> {
    return this.rpoplpush(source, destination);
  },

async blmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT', timeout: number): Promise<string | null> {
    return this.lmove(source, destination, srcDir, destDir);
  },

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
        this._cleanupListIfEmpty(key);
        return { key, elements: rows.map(r => r.value) };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  },

};
