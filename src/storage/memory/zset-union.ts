// @ts-nocheck

export const zsetUnionMethods = {
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