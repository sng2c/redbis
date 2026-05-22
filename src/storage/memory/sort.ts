// @ts-nocheck
import { assertTypeOneOf } from '../type-check';
import type { InMemoryStorage } from './core';

export const sortMethods = {
async sort(key: string, options?: {
    byPattern?: string;
    limit?: { offset: number; count: number };
    getPatterns?: string[];
    sortOrder?: 'ASC' | 'DESC';
    alpha?: boolean;
    store?: string;
  }): Promise<string[] | number> {
    this.evictIfExpired(key);

    // Check key type
    const entry = this.store.get(key);
    assertTypeOneOf(entry?.type, ['list', 'set', 'zset']);

    // Collect elements
    let elements: string[];
    if (!entry) {
      elements = [];
    } else if (entry.type === 'list') {
      elements = [...(this.listStore.get(key) ?? [])];
    } else if (entry.type === 'set') {
      elements = Array.from(this.setStore.get(key) ?? []);
    } else if (entry.type === 'zset') {
      const zset = this.zsetStore.get(key);
      elements = zset ? Array.from(zset.keys()) : [];
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
          // Lexicographic sort by weight value
          // Missing keys treated as '' for ALPHA sort
          cmp = (a.weight ?? '').localeCompare(b.weight ?? '');
        } else {
          // Numeric sort by weight value
          const aVal = a.weight;
          const bVal = b.weight;
          // Missing keys are treated as 0 in numeric sort (Redis behavior)
          const aNum = aVal === null ? 0 : parseFloat(aVal);
          const bNum = bVal === null ? 0 : parseFloat(bVal);
          if (isNaN(aNum) || isNaN(bNum)) {
            throw new Error('ERR One or more scores can\'t be converted into double');
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
            throw new Error('ERR One or more scores can\'t be converted into double');
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
      const isSelfPattern: boolean[] = [];
      const lookupKeysForMget: string[] = [];

      for (const el of elements) {
        for (const pattern of options.getPatterns) {
          if (pattern === '#') {
            isSelfPattern.push(true);
          } else {
            isSelfPattern.push(false);
            lookupKeysForMget.push(pattern.replace('*', el));
          }
        }
      }

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
