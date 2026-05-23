// @ts-nocheck
import { assertType } from '../type-check';
import type { InMemoryStorage } from './core';

export const zsetMethods = {
  _ensureZsetTypeOrThrow(key: string): void {
    assertType(this.store.get(key)?.type, 'zset');
  },

  _ensureZsetKeyExists(key: string): void {
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'zset', expiresAt: null });
    }
    if (!this.zsetStore.has(key)) {
      this.zsetStore.set(key, new Map());
    }
  },

  _cleanupZsetIfEmpty(key: string): void {
    const entry = this.store.get(key);
    // CRITICAL: must check type === 'zset' before deleting (Phase 2 bug pattern)
    if (!entry || entry.type !== 'zset') return;
    const zset = this.zsetStore.get(key);
    if (!zset || zset.size === 0) {
      this.zsetStore.delete(key);
      this.store.delete(key);
    }
  },

  _sortedMembers(key: string): Array<{ member: string; score: number }> {
    const zset = this.zsetStore.get(key);
    if (!zset) return [];
    return Array.from(zset.entries())
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
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

  _scoreInRange(
    score: number,
    min: { value: number; exclusive: boolean },
    max: { value: number; exclusive: boolean }
  ): boolean {
    const minOk = min.exclusive ? score > min.value : score >= min.value;
    const maxOk = max.exclusive ? score < max.value : score <= max.value;
    return minOk && maxOk;
  },

  _memberInLexRange(
    member: string,
    min: { value: string; exclusive: boolean; infinite: boolean },
    max: { value: string; exclusive: boolean; infinite: boolean }
  ): boolean {
    const minOk = min.infinite || (min.exclusive ? member > min.value : member >= min.value);
    const maxOk = max.infinite || (max.exclusive ? member < max.value : member <= max.value);
    return minOk && maxOk;
  },

  _formatScore(score: number): string {
    return parseFloat(score.toPrecision(15)).toString();
  },

  async zadd(
    key: string,
    scoreMembers: Array<{ score: number; member: string }>,
    options?: {
      nx?: boolean;
      xx?: boolean;
      gt?: boolean;
      lt?: boolean;
      ch?: boolean;
      incr?: boolean;
    }
  ): Promise<number | string | null> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);

    if (options?.incr) {
      // INCR mode: only one score-member pair allowed
      const { score, member } = scoreMembers[0];
      const zset = this.zsetStore.get(key);
      if (!zset || !zset.has(member)) {
        // Member doesn't exist
        if (options.xx) return null; // XX: only update existing
        this._ensureZsetKeyExists(key);
        const newZset = this.zsetStore.get(key)!;
        newZset.set(member, score);
        return this._formatScore(score);
      } else {
        // Member exists
        if (options.nx) return null; // NX: only add new
        const current = zset.get(member)!;
        let newScore: number;
        if (options.gt && score <= 0) return this._formatScore(current); // GT but increment not greater
        if (options.lt && score >= 0) return this._formatScore(current); // LT but increment not lesser
        if (options.gt && current + score <= current) return this._formatScore(current);
        if (options.lt && current + score >= current) return this._formatScore(current);
        newScore = current + score;
        zset.set(member, newScore);
        return this._formatScore(newScore);
      }
    }

    // Non-INCR mode
    let added = 0;
    let changed = 0;
    for (const { score, member } of scoreMembers) {
      const zset = this.zsetStore.get(key);
      if (!zset || !zset.has(member)) {
        // Member doesn't exist
        if (options?.xx) continue; // XX: only update existing
        this._ensureZsetKeyExists(key);
        this.zsetStore.get(key)!.set(member, score);
        added++;
      } else {
        // Member exists
        if (options?.nx) continue; // NX: only add new
        const current = zset.get(member)!;
        if (options?.gt && score <= current) continue; // GT: only update if new score > current
        if (options?.lt && score >= current) continue; // LT: only update if new score < current
        if (current !== score) changed++;
        zset.set(member, score);
      }
    }
    return options?.ch ? added + changed : added;
  },

  async zrem(key: string, members: string[]): Promise<number> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return 0;
    let removed = 0;
    for (const member of members) {
      if (zset.delete(member)) removed++;
    }
    this._cleanupZsetIfEmpty(key);
    return removed;
  },

  async zscore(key: string, member: string): Promise<string | null> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return null;
    const score = zset.get(member);
    return score !== undefined ? this._formatScore(score) : null;
  },

  async zcard(key: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    return zset ? zset.size : 0;
  },

  async zrange(
    key: string,
    min: number | string,
    max: number | string,
    options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }
  ): Promise<Array<{ member: string; score: number }>> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const sorted = this._sortedMembers(key);
    if (sorted.length === 0) return [];

    let filtered: Array<{ member: string; score: number }>;

    if (options?.byScore) {
      // Score mode
      const rev = options?.rev ?? false;
      const parsedMin = this._parseScoreBound(min, true);
      const parsedMax = this._parseScoreBound(max, false);
      // For rev, swap bounds
      if (rev) {
        filtered = sorted.filter((item) => this._scoreInRange(item.score, parsedMax, parsedMin));
        filtered.reverse();
      } else {
        filtered = sorted.filter((item) => this._scoreInRange(item.score, parsedMin, parsedMax));
      }
    } else if (options?.byLex) {
      // Lex mode
      const rev = options?.rev ?? false;
      const parsedMin = this._parseLexBound(String(min));
      const parsedMax = this._parseLexBound(String(max));
      if (rev) {
        filtered = sorted.filter((item) =>
          this._memberInLexRange(item.member, parsedMax, parsedMin)
        );
        filtered.reverse();
      } else {
        filtered = sorted.filter((item) =>
          this._memberInLexRange(item.member, parsedMin, parsedMax)
        );
      }
    } else {
      // Index mode
      let arr = options?.rev ? [...sorted].reverse() : sorted;
      let start = typeof min === 'number' ? min : parseInt(String(min), 10);
      let stop = typeof max === 'number' ? max : parseInt(String(max), 10);
      const len = arr.length;
      if (start < 0) start = Math.max(len + start, 0);
      if (stop < 0) stop = len + stop;
      if (start > stop || start >= len) return [];
      if (stop >= len) stop = len - 1;
      filtered = arr.slice(start, stop + 1);
    }

    // Apply offset/count
    if (options?.offset !== undefined || options?.count !== undefined) {
      const offset = options?.offset ?? 0;
      const count = options?.count ?? filtered.length;
      filtered = filtered.slice(offset, offset + count);
    }

    return filtered;
  },

  async zrank(key: string, member: string): Promise<number | null> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const sorted = this._sortedMembers(key);
    const idx = sorted.findIndex((item) => item.member === member);
    return idx >= 0 ? idx : null;
  },

  async zrevrank(key: string, member: string): Promise<number | null> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const sorted = this._sortedMembers(key);
    const idx = sorted.findIndex((item) => item.member === member);
    if (idx < 0) return null;
    return sorted.length - 1 - idx;
  },

  async zincrby(key: string, increment: number, member: string): Promise<string> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    this._ensureZsetKeyExists(key);
    const zset = this.zsetStore.get(key)!;
    const current = zset.get(member) ?? 0;
    const newScore = current + increment;
    zset.set(member, newScore);
    return this._formatScore(newScore);
  },

  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const sorted = this._sortedMembers(key);
    const parsedMin = this._parseScoreBound(min, true);
    const parsedMax = this._parseScoreBound(max, false);
    return sorted.filter((item) => this._scoreInRange(item.score, parsedMin, parsedMax)).length;
  },

  async zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return 0;
    const sorted = this._sortedMembers(key);
    const len = sorted.length;
    let s = start;
    let e = stop;
    if (s < 0) s = Math.max(len + s, 0);
    if (e < 0) e = len + e;
    if (s > e || s >= len) return 0;
    if (e >= len) e = len - 1;
    const toRemove = sorted.slice(s, e + 1);
    for (const item of toRemove) {
      zset.delete(item.member);
    }
    this._cleanupZsetIfEmpty(key);
    return toRemove.length;
  },

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return 0;
    const sorted = this._sortedMembers(key);
    const parsedMin = this._parseScoreBound(min, true);
    const parsedMax = this._parseScoreBound(max, false);
    const toRemove = sorted.filter((item) => this._scoreInRange(item.score, parsedMin, parsedMax));
    for (const item of toRemove) {
      zset.delete(item.member);
    }
    this._cleanupZsetIfEmpty(key);
    return toRemove.length;
  },

  async zremrangebylex(key: string, min: string, max: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return 0;
    const sorted = this._sortedMembers(key);
    const parsedMin = this._parseLexBound(min);
    const parsedMax = this._parseLexBound(max);
    const toRemove = sorted.filter((item) =>
      this._memberInLexRange(item.member, parsedMin, parsedMax)
    );
    for (const item of toRemove) {
      zset.delete(item.member);
    }
    this._cleanupZsetIfEmpty(key);
    return toRemove.length;
  },

  async zlexcount(key: string, min: string, max: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const sorted = this._sortedMembers(key);
    const parsedMin = this._parseLexBound(min);
    const parsedMax = this._parseLexBound(max);
    return sorted.filter((item) => this._memberInLexRange(item.member, parsedMin, parsedMax))
      .length;
  },

  async zscan(
    key: string,
    cursor: number,
    pattern?: string,
    count?: number
  ): Promise<[number, string[]]> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return [0, []];
    const sorted = this._sortedMembers(key);
    if (sorted.length === 0) return [0, []];
    const effectiveCount = count ?? 10;
    const regex = pattern ? this._hashGlobToRegex(pattern) : null;
    const result: string[] = [];
    let idx = cursor;
    while (idx < sorted.length && result.length < effectiveCount * 2) {
      const item = sorted[idx];
      idx++;
      if (!regex || regex.test(item.member)) {
        result.push(item.member, this._formatScore(item.score));
      }
    }
    const nextCursor = idx >= sorted.length ? 0 : idx;
    return [nextCursor, result];
  },

  async zpopmax(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset || zset.size === 0) return [];
    const sorted = this._sortedMembers(key);
    const actualCount = count ?? 1;
    const toPop = sorted.slice(-actualCount).reverse(); // highest scores first in result
    for (const item of toPop) {
      zset.delete(item.member);
    }
    this._cleanupZsetIfEmpty(key);
    return toPop;
  },

  async zpopmin(key: string, count?: number): Promise<Array<{ member: string; score: number }>> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset || zset.size === 0) return [];
    const sorted = this._sortedMembers(key);
    const actualCount = count ?? 1;
    const toPop = sorted.slice(0, actualCount);
    for (const item of toPop) {
      zset.delete(item.member);
    }
    this._cleanupZsetIfEmpty(key);
    return toPop;
  },

  async zrandmember(
    key: string,
    count?: number
  ): Promise<Array<{ member: string; score: number }>> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset || zset.size === 0) return [];
    const entries = Array.from(zset.entries()).map(([member, score]) => ({ member, score }));
    if (count === undefined) {
      const item = entries[Math.floor(Math.random() * entries.length)];
      return [item];
    }
    if (count > 0) {
      const shuffled = [...entries];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, Math.min(count, shuffled.length));
    } else {
      const result: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < Math.abs(count); i++) {
        result.push(entries[Math.floor(Math.random() * entries.length)]);
      }
      return result;
    }
  },

  async zmscore(key: string, members: string[]): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return members.map(() => null);
    return members.map((member) => {
      const score = zset.get(member);
      return score !== undefined ? this._formatScore(score) : null;
    });
  },

  async zrangestore(
    destination: string,
    source: string,
    min: number | string,
    max: number | string,
    options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }
  ): Promise<number> {
    this.evictIfExpired(destination);
    this.evictIfExpired(source);
    this._ensureZsetTypeOrThrow(source);
    this._ensureZsetTypeOrThrow(destination);
    const range = await this.zrange(source, min, max, options);
    if (range.length === 0) {
      // Delete destination if it's a zset
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this._ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    destZset.clear();
    for (const item of range) {
      destZset.set(item.member, item.score);
    }
    return range.length;
  },

  async zdiff(keys: string[]): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const firstZset = this.zsetStore.get(keys[0]);
    if (!firstZset) return [];
    const firstEntries = new Map(firstZset); // copy
    for (let i = 1; i < keys.length; i++) {
      const otherZset = this.zsetStore.get(keys[i]);
      if (otherZset) {
        for (const member of otherZset.keys()) {
          firstEntries.delete(member);
        }
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
    this.evictIfExpired(destination);
    for (const key of keys) this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(destination);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    const diff = await this.zdiff(keys);
    if (diff.length === 0) {
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this._ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    destZset.clear();
    for (const item of diff) {
      destZset.set(item.member, item.score);
    }
    return diff.length;
  },

  async zunion(
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const weights = options?.weights ?? keys.map(() => 1);
    const aggregate = options?.aggregate ?? 'SUM';
    const memberScores = new Map<string, number[]>();
    for (let i = 0; i < keys.length; i++) {
      const zset = this.zsetStore.get(keys[i]);
      const weight = weights[i] ?? 1;
      if (!zset) continue;
      for (const [member, score] of zset) {
        if (!memberScores.has(member)) memberScores.set(member, []);
        memberScores.get(member)!.push(score * weight);
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

  async zunionstore(
    destination: string,
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<number> {
    this.evictIfExpired(destination);
    for (const key of keys) this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(destination);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    const union = await this.zunion(keys, options);
    if (union.length === 0) {
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this._ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    destZset.clear();
    for (const item of union) {
      destZset.set(item.member, item.score);
    }
    return union.length;
  },

  async zinter(
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const weights = options?.weights ?? keys.map(() => 1);
    const aggregate = options?.aggregate ?? 'SUM';
    // Collect member -> [weighted scores per key they appear in]
    const memberKeyScores = new Map<string, Map<number, number>>(); // member -> (keyIndex -> weighted score)
    for (let i = 0; i < keys.length; i++) {
      const zset = this.zsetStore.get(keys[i]);
      if (!zset) continue;
      for (const [member, score] of zset) {
        if (!memberKeyScores.has(member)) memberKeyScores.set(member, new Map());
        memberKeyScores.get(member)!.set(i, score * (weights[i] ?? 1));
      }
    }
    const result: Array<{ member: string; score: number }> = [];
    for (const [member, keyScores] of memberKeyScores) {
      // Only include members present in ALL keys
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

  async zinterstore(
    destination: string,
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<number> {
    this.evictIfExpired(destination);
    for (const key of keys) this.evictIfExpired(key);
    this._ensureZsetTypeOrThrow(destination);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    const inter = await this.zinter(keys, options);
    if (inter.length === 0) {
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }
    this._ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    destZset.clear();
    for (const item of inter) {
      destZset.set(item.member, item.score);
    }
    return inter.length;
  },

  async zintercard(keys: string[], limit?: number): Promise<number> {
    for (const key of keys) this.evictIfExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return 0;
    // Intersection of member presence without weights/aggregate
    let memberSets: Set<string>[] = [];
    for (const key of keys) {
      const zset = this.zsetStore.get(key);
      if (!zset) return 0;
      memberSets.push(new Set(zset.keys()));
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

  async bzpopmax(
    keys: string[],
    timeout: number
  ): Promise<{ key: string; member: string; score: number } | null> {
    for (const key of keys) {
      this.evictIfExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const zset = this.zsetStore.get(key);
      if (zset && zset.size > 0) {
        const sorted = this._sortedMembers(key);
        const item = sorted[sorted.length - 1]; // max
        zset.delete(item.member);
        this._cleanupZsetIfEmpty(key);
        return { key, member: item.member, score: item.score };
      }
    }
    return null;
  },

  async bzpopmin(
    keys: string[],
    timeout: number
  ): Promise<{ key: string; member: string; score: number } | null> {
    for (const key of keys) {
      this.evictIfExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const zset = this.zsetStore.get(key);
      if (zset && zset.size > 0) {
        const sorted = this._sortedMembers(key);
        const item = sorted[0]; // min
        zset.delete(item.member);
        this._cleanupZsetIfEmpty(key);
        return { key, member: item.member, score: item.score };
      }
    }
    return null;
  },

  async bzmpop(
    numkeys: number,
    keys: string[],
    minmax: 'MIN' | 'MAX',
    count?: number
  ): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    const effectiveCount = count ?? 1;
    for (const key of keys) {
      this.evictIfExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const zset = this.zsetStore.get(key);
      if (zset && zset.size > 0) {
        const sorted = this._sortedMembers(key);
        const elements: Array<{ member: string; score: number }> = [];
        if (minmax === 'MIN') {
          for (let i = 0; i < effectiveCount && i < sorted.length; i++) {
            elements.push(sorted[i]);
            zset.delete(sorted[i].member);
          }
        } else {
          for (let i = sorted.length - 1; i >= 0 && elements.length < effectiveCount; i--) {
            elements.push(sorted[i]);
            zset.delete(sorted[i].member);
          }
        }
        this._cleanupZsetIfEmpty(key);
        return { key, elements };
      }
    }
    return null;
  },

  async zmpop(
    numkeys: number,
    keys: string[],
    minmax: 'MIN' | 'MAX',
    count?: number
  ): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    return this.bzmpop(numkeys, keys, minmax, count);
  },
};
