// @ts-nocheck
import type { SqliteStorage } from './core';

export const sortMethods = {
async sort(key: string, options?: {
    byPattern?: string;
    limit?: { offset: number; count: number };
    getPatterns?: string[];
    sortOrder?: 'ASC' | 'DESC';
    alpha?: boolean;
    store?: string;
  }): Promise<string[] | number> {
    this.evictExpired(key);

    // Check key type
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (typeRow && typeRow.type !== 'list' && typeRow.type !== 'set' && typeRow.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }

    // Collect elements
    let elements: string[];
    if (!typeRow) {
      elements = [];
    } else if (typeRow.type === 'list') {
      const rows = this.db.prepare('SELECT value FROM list_store WHERE key = ? ORDER BY seq ASC').all(key) as { value: string }[];
      elements = rows.map(r => r.value);
    } else if (typeRow.type === 'set') {
      const rows = this.db.prepare('SELECT member FROM set_store WHERE key = ?').all(key) as { member: string }[];
      elements = rows.map(r => r.member);
    } else if (typeRow.type === 'zset') {
      const rows = this.db.prepare('SELECT member FROM zset_store WHERE key = ?').all(key) as { member: string }[];
      elements = rows.map(r => r.member);
    } else {
      elements = [];
    }

    if (elements.length === 0) {
      if (options?.store) {
        await this.delete(options.store);
        return 0;
      }
      return [];
    }

    // Apply BY pattern to get sort weights
    if (options?.byPattern) {
      const lookupKeys = elements.map(el => options.byPattern!.replace('*', el));
      const weights = await this.mget(lookupKeys);
      const pairs: { element: string; weight: string | null }[] = elements.map((el, i) => ({
        element: el,
        weight: weights[i]
      }));

      // Sort using weights
      const sortOrder = options?.sortOrder ?? 'ASC';
      pairs.sort((a, b) => {
        let cmp: number;
        if (options?.alpha) {
          // Missing keys treated as '' for ALPHA sort
          cmp = (a.weight ?? '').localeCompare(b.weight ?? '');
        } else {
          // Missing keys are treated as 0 in numeric sort (Redis behavior)
          const aNum = a.weight === null ? 0 : parseFloat(a.weight);
          const bNum = b.weight === null ? 0 : parseFloat(b.weight);
          if (isNaN(aNum) || isNaN(bNum)) {
            throw new Error("ERR One or more scores can't be converted into double");
          }
          cmp = aNum - bNum;
        }
        return sortOrder === 'DESC' ? -cmp : cmp;
      });

      elements = pairs.map(p => p.element);
    } else {
      // Sort by elements themselves
      const sortOrder = options?.sortOrder ?? 'ASC';
      elements.sort((a, b) => {
        let cmp: number;
        if (options?.alpha) {
          cmp = a.localeCompare(b);
        } else {
          const aNum = parseFloat(a);
          const bNum = parseFloat(b);
          if (isNaN(aNum) || isNaN(bNum)) {
            throw new Error("ERR One or more scores can't be converted into double");
          }
          cmp = aNum - bNum;
        }
        return sortOrder === 'DESC' ? -cmp : cmp;
      });
    }

    // Apply LIMIT
    if (options?.limit) {
      const { offset, count } = options.limit;
      elements = elements.slice(offset, offset + count);
    }

    // Apply GET patterns
    if (options?.getPatterns && options.getPatterns.length > 0) {
      const result: string[] = [];
      const patternCount = options.getPatterns.length;
      const allLookupKeys: string[] = [];
      const isSelfPattern: boolean[] = [];

      for (const el of elements) {
        for (const pattern of options.getPatterns) {
          if (pattern === '#') {
            allLookupKeys.push(el); // placeholder; will be handled specially
            isSelfPattern.push(true);
          } else {
            allLookupKeys.push(pattern.replace('*', el));
            isSelfPattern.push(false);
          }
        }
      }

      const lookupKeysForMget = allLookupKeys.filter((_, i) => !isSelfPattern[i]);
      const mgetResults = lookupKeysForMget.length > 0 ? await this.mget(lookupKeysForMget) : [];
      let mgetIndex = 0;

      for (const el of elements) {
        for (let p = 0; p < patternCount; p++) {
          const pattern = options.getPatterns![p];
          if (pattern === '#') {
            result.push(el);
          } else {
            const val = mgetResults[mgetIndex++];
            result.push(val ?? '');
          }
        }
      }

      if (options.store) {
        await this.delete(options.store);
        await this.rpush(options.store, result);
        return result.length;
      }
      return result;
    }

    // No GET patterns
    if (options?.store) {
      await this.delete(options.store);
      await this.rpush(options.store, elements);
      return elements.length;
    }

    return elements;
  },

};
