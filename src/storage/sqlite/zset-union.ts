// @ts-nocheck

export const zsetUnionMethods = {
  async zdiff(keys: string[]): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const firstRows = this.db
      .prepare('SELECT member, score FROM zset_store WHERE key = ?')
      .all(keys[0]) as { member: string; score: number }[];
    if (firstRows.length === 0) return [];
    const firstEntries = new Map<string, number>(
      firstRows.map((r) => [r.member, r.score] as [string, number])
    );
    for (let i = 1; i < keys.length; i++) {
      const otherRows = this.db
        .prepare('SELECT member FROM zset_store WHERE key = ?')
        .all(keys[i]) as { member: string }[];
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
        const destRow = this.db
          .prepare('SELECT type FROM kv_store WHERE key = ?')
          .get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'zset') {
          this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this._ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of diff) {
        this.db
          .prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)')
          .run(destination, item.member, item.score);
      }
      return diff.length;
    });
    return tx();
  },

  async zunion(
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const weights = options?.weights ?? keys.map(() => 1);
    const aggregate = options?.aggregate ?? 'SUM';
    const memberScores = new Map<string, number[]>();
    for (let i = 0; i < keys.length; i++) {
      const weight = weights[i] ?? 1;
      const rows = this.db
        .prepare('SELECT member, score FROM zset_store WHERE key = ?')
        .all(keys[i]) as { member: string; score: number }[];
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

  async zunionstore(
    destination: string,
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this._ensureZsetTypeOrThrow(destination);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    const union = await this.zunion(keys, options);
    const tx = this.db.transaction(() => {
      if (union.length === 0) {
        const destRow = this.db
          .prepare('SELECT type FROM kv_store WHERE key = ?')
          .get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'zset') {
          this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this._ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of union) {
        this.db
          .prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)')
          .run(destination, item.member, item.score);
      }
      return union.length;
    });
    return tx();
  },

  async zinter(
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<Array<{ member: string; score: number }>> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    if (keys.length === 0) return [];
    const weights = options?.weights ?? keys.map(() => 1);
    const aggregate = options?.aggregate ?? 'SUM';
    const memberKeyScores = new Map<string, Map<number, number>>();
    for (let i = 0; i < keys.length; i++) {
      const weight = weights[i] ?? 1;
      const rows = this.db
        .prepare('SELECT member, score FROM zset_store WHERE key = ?')
        .all(keys[i]) as { member: string; score: number }[];
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

  async zinterstore(
    destination: string,
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<number> {
    this.evictExpired(destination);
    for (const key of keys) this.evictExpired(key);
    this._ensureZsetTypeOrThrow(destination);
    for (const key of keys) this._ensureZsetTypeOrThrow(key);
    const inter = await this.zinter(keys, options);
    const tx = this.db.transaction(() => {
      if (inter.length === 0) {
        const destRow = this.db
          .prepare('SELECT type FROM kv_store WHERE key = ?')
          .get(destination) as { type: string } | undefined;
        if (destRow && destRow.type === 'zset') {
          this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
          this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
        }
        return 0;
      }
      this._ensureZsetKvStoreEntry(destination);
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      for (const item of inter) {
        this.db
          .prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)')
          .run(destination, item.member, item.score);
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
      const rows = this.db.prepare('SELECT member FROM zset_store WHERE key = ?').all(key) as {
        member: string;
      }[];
      if (rows.length === 0) return 0;
      memberSets.push(new Set(rows.map((r) => r.member)));
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
      this.evictExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const row = this.db
          .prepare(
            'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score DESC, member DESC LIMIT 1'
          )
          .get(key) as { member: string; score: number } | undefined;
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

  async bzpopmin(
    keys: string[],
    timeout: number
  ): Promise<{ key: string; member: string; score: number } | null> {
    for (const key of keys) {
      this.evictExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const row = this.db
          .prepare(
            'SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ASC, member ASC LIMIT 1'
          )
          .get(key) as { member: string; score: number } | undefined;
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

  async bzmpop(
    numkeys: number,
    keys: string[],
    minmax: 'MIN' | 'MAX',
    count?: number
  ): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null> {
    const effectiveCount = count ?? 1;
    for (const key of keys) {
      this.evictExpired(key);
      this._ensureZsetTypeOrThrow(key);
      const tx = this.db.transaction(() => {
        const orderClause = minmax === 'MIN' ? 'ASC' : 'DESC';
        const rows = this.db
          .prepare(
            `SELECT member, score FROM zset_store WHERE key = ? ORDER BY score ${orderClause}, member ${orderClause} LIMIT ?`
          )
          .all(key, effectiveCount) as { member: string; score: number }[];
        if (rows.length === 0) return null;
        for (const row of rows) {
          this.db
            .prepare('DELETE FROM zset_store WHERE key = ? AND member = ?')
            .run(key, row.member);
        }
        this._cleanupZsetIfEmpty(key);
        return { key, elements: rows.map((r) => ({ member: r.member, score: r.score })) };
      });
      const result = tx();
      if (result) return result;
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