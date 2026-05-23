// @ts-nocheck
import { assertType, assertTypeOneOf, WRONGTYPE_ERROR } from '../type-check';
import { globToRegex } from '../../utils/glob';
import type { SqliteStorage } from './core';

export const setMethods = {
_ensureSetTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    assertType(row?.type, 'set');
  },

_ensureSetKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    assertType(row?.type, 'set');
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'set', NULL)").run(key);
    }
  },

_cleanupSetIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (!typeRow || typeRow.type !== 'set') return;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM set_store WHERE key = ?').get(key) as { cnt: number };
    if (row.cnt === 0) {
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
  },

async sadd(key: string, members: string[]): Promise<number> {
    this.evictExpired(key);
    const tx = this.db.transaction(() => {
      this._ensureSetKvStoreEntry(key);
      let added = 0;
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)');
      for (const member of members) {
        const result = insertStmt.run(key, member);
        added += result.changes;
      }
      return added;
    });
    return tx();
  },

async srem(key: string, members: string[]): Promise<number> {
    this.evictExpired(key);
    this._ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      let removed = 0;
      const deleteStmt = this.db.prepare('DELETE FROM set_store WHERE key = ? AND member = ?');
      for (const member of members) {
        const result = deleteStmt.run(key, member);
        removed += result.changes;
      }
      this._cleanupSetIfEmpty(key);
      return removed;
    });
    return tx();
  },

async smembers(key: string): Promise<string[]> {
    this.evictExpired(key);
    this._ensureSetTypeOrThrow(key);
    const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(key) as { member: string }[];
    return rows.map(r => r.member);
  },

async scard(key: string): Promise<number> {
    this.evictExpired(key);
    this._ensureSetTypeOrThrow(key);
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM set_store WHERE key = ?').get(key) as { cnt: number };
    return row.cnt;
  },

async sismember(key: string, member: string): Promise<boolean> {
    this.evictExpired(key);
    this._ensureSetTypeOrThrow(key);
    const row = this.db.prepare('SELECT 1 FROM set_store WHERE key = ? AND member = ? LIMIT 1').get(key, member);
    return !!row;
  },

async smismember(key: string, members: string[]): Promise<boolean[]> {
    this.evictExpired(key);
    this._ensureSetTypeOrThrow(key);
    if (members.length === 0) return [];
    const placeholders = members.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT member FROM set_store WHERE key = ? AND member IN (${placeholders})`
    ).all(key, ...members) as { member: string }[];
    const found = new Set(rows.map(r => r.member));
    return members.map(m => found.has(m));
  },

async srandmember(key: string, count?: number): Promise<string[]> {
    this.evictExpired(key);
    this._ensureSetTypeOrThrow(key);
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
  },

async spop(key: string, count?: number): Promise<string[]> {
    this.evictExpired(key);
    this._ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const actualCount = count ?? 1;
      const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ? ORDER BY RANDOM() LIMIT ?').all(key, actualCount) as { member: string }[];
      if (rows.length === 0) return [];
      const deleteStmt = this.db.prepare('DELETE FROM set_store WHERE key = ? AND member = ?');
      for (const row of rows) {
        deleteStmt.run(key, row.member);
      }
      this._cleanupSetIfEmpty(key);
      return rows.map(r => r.member);
    });
    return tx();
  },

async smove(source: string, destination: string, member: string): Promise<boolean> {
    this.evictExpired(source);
    this.evictExpired(destination);
    this._ensureSetTypeOrThrow(source);
    this._ensureSetTypeOrThrow(destination);
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT 1 FROM set_store WHERE key = ? AND member = ?').get(source, member);
      if (!row) return false;
      this.db.prepare('DELETE FROM set_store WHERE key = ? AND member = ?').run(source, member);
      if (source !== destination) {
        this._ensureSetKvStoreEntry(destination);
        this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)').run(destination, member);
      } else {
        this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)').run(source, member);
      }
      this._cleanupSetIfEmpty(source);
      return true;
    });
    return tx();
  },

async sdiff(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
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
  },

async sinter(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
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
  },

async sunion(keys: string[]): Promise<string[]> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const result = new Set<string>();
    for (const key of keys) {
      const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(key) as { member: string }[];
      for (const row of rows) {
        result.add(row.member);
      }
    }
    return Array.from(result);
  },

async sdiffstore(destination: string, keys: string[]): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this._ensureSetTypeOrThrow(destination);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const diff = this.__computeSetDiff(keys);
      if (diff.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'set') {
          this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this._ensureSetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)');
      for (const member of diff) {
        insertStmt.run(destination, member);
      }
      return diff.length;
    });
    return tx();
  },

async sinterstore(destination: string, keys: string[]): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this._ensureSetTypeOrThrow(destination);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const inter = this.__computeSetInter(keys);
      if (inter.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'set') {
          this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this._ensureSetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)');
      for (const member of inter) {
        insertStmt.run(destination, member);
      }
      return inter.length;
    });
    return tx();
  },

async sunionstore(destination: string, keys: string[]): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this._ensureSetTypeOrThrow(destination);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const union = this.__computeSetUnion(keys);
      if (union.length === 0) {
        const destRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'set') {
          this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this._ensureSetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM set_store WHERE key = ?').run(destination);
      const insertStmt = this.db.prepare('INSERT OR IGNORE INTO set_store (key, member) VALUES (?, ?)');
      for (const member of union) {
        insertStmt.run(destination, member);
      }
      return union.length;
    });
    return tx();
  },

__computeSetDiff(keys: string[]): string[] {
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
  },

__computeSetInter(keys: string[]): string[] {
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
  },

__computeSetUnion(keys: string[]): string[] {
    if (keys.length === 0) return [];
    const result = new Set<string>();
    for (const key of keys) {
      const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(key) as { member: string }[];
      for (const row of rows) {
        result.add(row.member);
      }
    }
    return Array.from(result);
  },

async sintercard(keys: string[], limit?: number): Promise<number> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureSetTypeOrThrow(key);
    const inter = this.__computeSetInter(keys);
    if (limit !== undefined) {
      return Math.min(inter.length, limit);
    }
    return inter.length;
  },

async sscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]> {
    this.evictExpired(key);
    this._ensureSetTypeOrThrow(key);
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
  },

};
