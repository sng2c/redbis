// @ts-nocheck
import { globToRegex } from './types';
import type { SqliteStorage } from './core';

export const zsetMethods = {
_ensureZsetTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  },

_ensureZsetKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    if (!row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'zset', NULL)").run(key);
    }
  },

_cleanupZsetIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    // CRITICAL: must check type === 'zset' before deleting (Phase 2 bug pattern)
    if (!typeRow || typeRow.type !== 'zset') return;
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
    if (row.cnt === 0) {
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
  },

_parseScoreBound(bound: number | string, _isMin: boolean): { value: number; exclusive: boolean } {
    if (typeof bound === 'number') return { value: bound, exclusive: false };
    const str = String(bound);
    if (str === '-inf') return { value: -Infinity, exclusive: false };
    if (str === '+inf' || str === 'inf') return { value: Infinity, exclusive: false };
    if (str.startsWith('(')) {
      return { value: parseFloat(str.slice(1)), exclusive: true };
    }
    return { value: parseFloat(str), exclusive: false };
  },

_parseLexBound(bound: string): { value: string; exclusive: boolean; infinite: boolean } {
    if (bound === '-') return { value: '', exclusive: false, infinite: true };
    if (bound === '+') return { value: '\uffff', exclusive: false, infinite: true };
    if (bound.startsWith('[')) return { value: bound.slice(1), exclusive: false, infinite: false };
    if (bound.startsWith('(')) return { value: bound.slice(1), exclusive: true, infinite: false };
    return { value: bound, exclusive: false, infinite: false };
  },

_buildScoreWhereClause(min: { value: number; exclusive: boolean }, max: { value: number; exclusive: boolean }): { sql: string; params: any[] } {
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
  },

_buildLexWhereClause(min: { value: string; exclusive: boolean; infinite: boolean }, max: { value: string; exclusive: boolean; infinite: boolean }): { sql: string; params: any[] } {
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
  },

_formatScore(score: number): string {
    return parseFloat(score.toPrecision(15)).toString();
  },

async zadd(key: string, scoreMembers: Array<{ score: number; member: string }>, options?: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean; ch?: boolean; incr?: boolean }): Promise<number | string | null> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);

    if (options?.incr) {
      const { score, member } = scoreMembers[0];
      const tx = this.db.transaction(() => {
        const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
        if (!row) {
          if (options.xx) return null;
          this._ensureZsetKvStoreEntry(key);
          this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(key, member, score);
          return this._formatScore(score);
        } else {
          if (options.nx) return this._formatScore(row.score);
          const current = row.score;
          if (options.gt && score <= 0) return this._formatScore(current);
          if (options.lt && score >= 0) return this._formatScore(current);
          if (options.gt && current + score <= current) return this._formatScore(current);
          if (options.lt && current + score >= current) return this._formatScore(current);
          const newScore = current + score;
          this.db.prepare('UPDATE zset_store SET score = ? WHERE key = ? AND member = ?').run(newScore, key, member);
          return this._formatScore(newScore);
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
          this._ensureZsetKvStoreEntry(key);
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
  },

async zrem(key: string, members: string[]): Promise<number> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      let removed = 0;
      for (const member of members) {
        const result = this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, member);
        removed += result.changes;
      }
      this._cleanupZsetIfEmpty(key);
      return removed;
    });
    return tx();
  },

async zscore(key: string, member: string): Promise<string | null> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
    return row ? this._formatScore(row.score) : null;
  },

async zcard(key: string): Promise<number> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
    return row.cnt;
  },

async zrange(key: string, min: number | string, max: number | string, options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }): Promise<Array<{ member: string; score: number }>> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);

    const rev = options?.rev ?? false;
    const orderDir = rev ? 'DESC' : 'ASC';

    if (options?.byScore) {
      const parsedMin = this._parseScoreBound(min, true);
      const parsedMax = this._parseScoreBound(max, false);
      // For rev, swap bounds for query but use DESC order
      const queryMin = rev ? parsedMax : parsedMin;
      const queryMax = rev ? parsedMin : parsedMax;
      const { sql: whereClause, params: whereParams } = this._buildScoreWhereClause(queryMin, queryMax);
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
      const parsedMin = this._parseLexBound(String(min));
      const parsedMax = this._parseLexBound(String(max));
      const queryMin = rev ? parsedMax : parsedMin;
      const queryMax = rev ? parsedMin : parsedMax;
      const { sql: whereClause, params: whereParams } = this._buildLexWhereClause(queryMin, queryMax);
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
  },

async zrank(key: string, member: string): Promise<number | null> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
    if (!row) return null;
    const cntRow = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM zset_store WHERE key = ? AND (score < ? OR (score = ? AND member < ?))'
    ).get(key, row.score, row.score, member) as { cnt: number };
    return cntRow.cnt;
  },

async zrevrank(key: string, member: string): Promise<number | null> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
    if (!row) return null;
    const cntRow = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM zset_store WHERE key = ? AND (score > ? OR (score = ? AND member > ?))'
    ).get(key, row.score, row.score, member) as { cnt: number };
    return cntRow.cnt;
  },

async zincrby(key: string, increment: number, member: string): Promise<string> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      this._ensureZsetKvStoreEntry(key);
      const row = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
      const current = row ? row.score : 0;
      const newScore = current + increment;
      this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(key, member, newScore);
      return this._formatScore(newScore);
    });
    return tx();
  },

async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const parsedMin = this._parseScoreBound(min, true);
    const parsedMax = this._parseScoreBound(max, false);
    const { sql: whereClause, params: whereParams } = this._buildScoreWhereClause(parsedMin, parsedMax);
    const sql = `SELECT COUNT(*) as cnt FROM zset_store WHERE key = ? AND ${whereClause}`;
    const row = this.db.prepare(sql).get(key, ...whereParams) as { cnt: number };
    return row.cnt;
  },

async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
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
      this._cleanupZsetIfEmpty(key);
      return toRemove.length;
    });
    return tx();
  },

async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const parsedMin = this._parseScoreBound(min, true);
      const parsedMax = this._parseScoreBound(max, false);
      const { sql: whereClause, params: whereParams } = this._buildScoreWhereClause(parsedMin, parsedMax);
      const sql = `DELETE FROM zset_store WHERE key = ? AND ${whereClause}`;
      const result = this.db.prepare(sql).run(key, ...whereParams);
      this._cleanupZsetIfEmpty(key);
      return result.changes;
    });
    return tx();
  },

async zremrangebylex(key: string, min: string, max: string): Promise<number> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const parsedMin = this._parseLexBound(min);
      const parsedMax = this._parseLexBound(max);
      const { sql: whereClause, params: whereParams } = this._buildLexWhereClause(parsedMin, parsedMax);
      if (whereClause === '1=1') {
        // No bounds: delete all
        const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
        this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(key);
        this._cleanupZsetIfEmpty(key);
        return cntRow.cnt;
      }
      const sql = `DELETE FROM zset_store WHERE key = ? AND ${whereClause}`;
      const result = this.db.prepare(sql).run(key, ...whereParams);
      this._cleanupZsetIfEmpty(key);
      return result.changes;
    });
    return tx();
  },

async zlexcount(key: string, min: string, max: string): Promise<number> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const parsedMin = this._parseLexBound(min);
    const parsedMax = this._parseLexBound(max);
    const { sql: whereClause, params: whereParams } = this._buildLexWhereClause(parsedMin, parsedMax);
    if (whereClause === '1=1') {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM zset_store WHERE key = ?').get(key) as { cnt: number };
      return row.cnt;
    }
    const sql = `SELECT COUNT(*) as cnt FROM zset_store WHERE key = ? AND ${whereClause}`;
    const row = this.db.prepare(sql).get(key, ...whereParams) as { cnt: number };
    return row.cnt;
  },

async zscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
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
        result.push(row.member, this._formatScore(row.score));
      }
    }
    const nextCursor = idx >= rows.length ? 0 : idx;
    return [nextCursor, result];
  },

async zpopmax(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const actualCount = count ?? 1;
      const rows = this.db.prepare(
        'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score DESC, member DESC LIMIT ?'
      ).all(key, actualCount) as { member: string; score: number }[];
      if (rows.length === 0) return [];
      for (const row of rows) {
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
      }
      this._cleanupZsetIfEmpty(key);
      // Return in descending score order
      return rows.map(r => ({ member: r.member, score: r.score }));
    });
    return tx();
  },

async zpopmin(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const tx = this.db.transaction(() => {
      const actualCount = count ?? 1;
      const rows = this.db.prepare(
        'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ASC, member ASC LIMIT ?'
      ).all(key, actualCount) as { member: string; score: number }[];
      if (rows.length === 0) return [];
      for (const row of rows) {
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
      }
      this._cleanupZsetIfEmpty(key);
      return rows.map(r => ({ member: r.member, score: r.score }));
    });
    return tx();
  },

async zrandmember(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
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
  },

async zmscore(key: string, members: string[]): Promise<(string | null)[]> {
    this.evictExpired(key);
    this._ensureZsetTypeOrThrow(key);
    if (members.length === 0) return [];
    const placeholders = members.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT member, score FROM zset_store WHERE key = ? AND member IN (${placeholders})`
    ).all(key, ...members) as { member: string; score: number }[];
    const map = new Map(rows.map(r => [r.member, r.score] as [string, number]));
    return members.map(m => {
      const score = map.get(m);
      return score !== undefined ? this._formatScore(score) : null;
    });
  },

async zrangestore(destination: string, source: string, min: number | string, max: number | string, options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }): Promise<number> {
    this.evictExpired(destination);
    this.evictExpired(source);
    this._ensureZsetTypeOrThrow(source);
    this._ensureZsetTypeOrThrow(destination);
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
      this._ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of range) {
        this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, item.member, item.score);
      }
      return range.length;
    });
    return tx();
  },

async zdiff(keys: string[]): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
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
  },

async zdiffstore(destination: string, keys: string[]): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this._ensureZsetTypeOrThrow(destination);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
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
      this._ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of diff) {
        this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, item.member, item.score);
      }
      return diff.length;
    });
    return tx();
  },

async zunion(keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
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
  },

async zunionstore(destination: string, keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this._ensureZsetTypeOrThrow(destination);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
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
      this._ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of union) {
        this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, item.member, item.score);
      }
      return union.length;
    });
    return tx();
  },

async zinter(keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
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
  },

async zinterstore(destination: string, keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this._ensureZsetTypeOrThrow(destination);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
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
      this._ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of inter) {
        this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, item.member, item.score);
      }
      return inter.length;
    });
    return tx();
  },

async zintercard(keys: string[], limit?: number): Promise<number> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
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
  },

async bzpopmax(keys: string[], timeout: number): Promise<{ key: string; member: string; score: number } | null> {
    for (const key of keys) {
      this.evictExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const row = this.db.prepare(
          'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score DESC, member DESC LIMIT 1'
        ).get(key) as { member: string; score: number } | undefined;
        if (!row) return null;
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
        this._cleanupZsetIfEmpty(key);
        return { key, member: row.member, score: row.score };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  },

async bzpopmin(keys: string[], timeout: number): Promise<{ key: string; member: string; score: number } | null> {
    for (const key of keys) {
      this.evictExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const row = this.db.prepare(
          'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ASC, member ASC LIMIT 1'
        ).get(key) as { member: string; score: number } | undefined;
        if (!row) return null;
        this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
        this._cleanupZsetIfEmpty(key);
        return { key, member: row.member, score: row.score };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  },

async bzmpop(numkeys: number, keys: string[], minmax: 'MIN' | 'MAX', count?: number): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    const effectiveCount = count ?? 1;
    for (const key of keys) {
      this.evictExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const orderClause = minmax === 'MIN' ? 'ASC' : 'DESC';
        const rows = this.db.prepare(
          `SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ${orderClause}, member ${orderClause} LIMIT ?`
        ).all(key, effectiveCount) as { member: string; score: number }[];
        if (rows.length === 0) return null;
        for (const row of rows) {
          this.db.prepare('DELETE FROM zset_store WHERE key = ? AND member = ?').run(key, row.member);
        }
        this._cleanupZsetIfEmpty(key);
        return { key, elements: rows.map(r => ({ member: r.member, score: r.score })) };
      });
      const result = tx();
      if (result) return result;
    }
    return null;
  },

async zmpop(numkeys: number, keys: string[], minmax: 'MIN' | 'MAX', count?: number): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    return this.bzmpop(numkeys, keys, minmax, count);
  },

};
