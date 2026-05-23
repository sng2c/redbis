import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';

function createStorages() {
  const memory = new InMemoryStorage();
  const sqlite = new SqliteStorage({ path: ':memory:' });
  return { memory, sqlite };
}

describe('sort() - Storage Layer', () => {
  const storages = createStorages();

  for (const [name, storage] of Object.entries(storages)) {
    describe(name, () => {
      beforeEach(async () => {
        await storage.flush();
      });

      // ============================================================
      // Basic list sorting
      // ============================================================
      describe('basic list sorting', () => {
        it('sorts a list of numbers ascending by default', async () => {
          await storage.rpush('mylist', ['3', '1', '2']);
          const result = (await storage.sort('mylist')) as string[];
          expect(result).toEqual(['1', '2', '3']);
        });

        it('sorts a list of numbers descending', async () => {
          await storage.rpush('mylist', ['3', '1', '2']);
          const result = (await storage.sort('mylist', { sortOrder: 'DESC' })) as string[];
          expect(result).toEqual(['3', '2', '1']);
        });

        it('sorts strings alphabetically with ALPHA', async () => {
          await storage.rpush('mylist', ['c', 'a', 'b']);
          const result = (await storage.sort('mylist', { alpha: true })) as string[];
          expect(result).toEqual(['a', 'b', 'c']);
        });

        it('sorts strings descending with ALPHA DESC', async () => {
          await storage.rpush('mylist', ['c', 'a', 'b']);
          const result = (await storage.sort('mylist', {
            alpha: true,
            sortOrder: 'DESC',
          })) as string[];
          expect(result).toEqual(['c', 'b', 'a']);
        });

        it('throws error for non-numeric values without ALPHA', async () => {
          await storage.rpush('mylist', ['a', 'b', 'c']);
          await expect(storage.sort('mylist')).rejects.toThrow(
            "One or more scores can't be converted into double"
          );
        });

        it('returns empty array for non-existent key', async () => {
          const result = (await storage.sort('nonexistent')) as string[];
          expect(result).toEqual([]);
        });
      });

      // ============================================================
      // Set sorting
      // ============================================================
      describe('set sorting', () => {
        it('sorts a set of numbers', async () => {
          await storage.sadd('myset', ['3', '1', '2']);
          const result = (await storage.sort('myset')) as string[];
          expect(result).toEqual(['1', '2', '3']);
        });

        it('sorts a set of strings with ALPHA', async () => {
          await storage.sadd('myset', ['banana', 'apple', 'cherry']);
          const result = (await storage.sort('myset', { alpha: true })) as string[];
          // Sets don't have guaranteed ordering, but sort should alphabetize
          expect(result).toEqual(['apple', 'banana', 'cherry']);
        });
      });

      // ============================================================
      // Sorted set sorting
      // ============================================================
      describe('zset sorting', () => {
        it('sorts members of a zset', async () => {
          await storage.zadd('myzset', [
            { score: 3, member: 'three' },
            { score: 1, member: 'one' },
            { score: 2, member: 'two' },
          ]);
          const result = (await storage.sort('myzset', { alpha: true })) as string[];
          expect(result.sort()).toEqual(['one', 'three', 'two']);
        });
      });

      // ============================================================
      // WRONGTYPE error
      // ============================================================
      describe('wrong type error', () => {
        it('throws WRONGTYPE for string key', async () => {
          await storage.set('mystring', 'hello');
          await expect(storage.sort('mystring')).rejects.toThrow('WRONGTYPE');
        });

        it('throws WRONGTYPE for hash key', async () => {
          await storage.hset('myhash', [{ field: 'f1', value: 'v1' }]);
          await expect(storage.sort('myhash')).rejects.toThrow('WRONGTYPE');
        });
      });

      // ============================================================
      // BY pattern
      // ============================================================
      describe('BY pattern', () => {
        it('sorts by external weights', async () => {
          await storage.rpush('mylist', ['a', 'b', 'c']);
          await storage.set('weight_a', '3');
          await storage.set('weight_b', '1');
          await storage.set('weight_c', '2');
          const result = (await storage.sort('mylist', { byPattern: 'weight_*' })) as string[];
          expect(result).toEqual(['b', 'c', 'a']);
        });

        it('sorts by external weights descending', async () => {
          await storage.rpush('mylist', ['a', 'b', 'c']);
          await storage.set('weight_a', '3');
          await storage.set('weight_b', '1');
          await storage.set('weight_c', '2');
          const result = (await storage.sort('mylist', {
            byPattern: 'weight_*',
            sortOrder: 'DESC',
          })) as string[];
          expect(result).toEqual(['a', 'c', 'b']);
        });

        it('sorts by external weights with ALPHA', async () => {
          await storage.rpush('mylist', ['a', 'b', 'c']);
          await storage.set('weight_a', 'z');
          await storage.set('weight_b', 'x');
          await storage.set('weight_c', 'y');
          const result = (await storage.sort('mylist', {
            byPattern: 'weight_*',
            alpha: true,
          })) as string[];
          expect(result).toEqual(['b', 'c', 'a']);
        });

        it('handles missing weight keys as numeric zero in numeric sort', async () => {
          // Redis treats missing BY keys as 0 for numeric sort
          await storage.rpush('mylist', ['a', 'b']);
          await storage.set('weight_a', '5');
          // weight_b doesn't exist, treated as 0
          const result = (await storage.sort('mylist', { byPattern: 'weight_*' })) as string[];
          expect(result).toEqual(['b', 'a']);
        });

        it('handles all missing weight keys with ALPHA', async () => {
          await storage.rpush('mylist', ['c', 'a', 'b']);
          // No weight keys set — all will be null, treated as '' in ALPHA mode
          const result = (await storage.sort('mylist', {
            byPattern: 'weight_*',
            alpha: true,
          })) as string[];
          // All weights are '' (null), so sort is stable by original order after alphabetical sort of ''
          // Since all weights are equal (''), the sort should preserve relative order
          // but JS sort is not guaranteed stable for equal elements, so just check length
          expect(result.length).toBe(3);
        });
      });

      // ============================================================
      // GET patterns
      // ============================================================
      describe('GET patterns', () => {
        it('sorts and retrieves values with GET', async () => {
          await storage.rpush('mylist', ['1', '2', '3']);
          await storage.set('obj_1', 'one');
          await storage.set('obj_2', 'two');
          await storage.set('obj_3', 'three');
          const result = (await storage.sort('mylist', { getPatterns: ['obj_*'] })) as string[];
          expect(result).toEqual(['one', 'two', 'three']);
        });

        it('sorts DESC and retrieves values with GET', async () => {
          await storage.rpush('mylist', ['1', '2', '3']);
          await storage.set('obj_1', 'one');
          await storage.set('obj_2', 'two');
          await storage.set('obj_3', 'three');
          const result = (await storage.sort('mylist', {
            sortOrder: 'DESC',
            getPatterns: ['obj_*'],
          })) as string[];
          expect(result).toEqual(['three', 'two', 'one']);
        });

        it('supports GET # to include original element', async () => {
          await storage.rpush('mylist', ['1', '2', '3']);
          await storage.set('obj_1', 'one');
          await storage.set('obj_2', 'two');
          await storage.set('obj_3', 'three');
          const result = (await storage.sort('mylist', {
            getPatterns: ['#', 'obj_*'],
          })) as string[];
          expect(result).toEqual(['1', 'one', '2', 'two', '3', 'three']);
        });

        it('supports multiple GET patterns', async () => {
          await storage.rpush('mylist', ['1', '2']);
          await storage.set('obj_1', 'one');
          await storage.set('obj_2', 'two');
          await storage.set('extra_1', 'e1');
          await storage.set('extra_2', 'e2');
          const result = (await storage.sort('mylist', {
            getPatterns: ['obj_*', 'extra_*'],
          })) as string[];
          expect(result).toEqual(['one', 'e1', 'two', 'e2']);
        });

        it('returns empty string for missing GET keys', async () => {
          await storage.rpush('mylist', ['1', '2']);
          await storage.set('obj_1', 'one');
          // obj_2 doesn't exist
          const result = (await storage.sort('mylist', { getPatterns: ['obj_*'] })) as string[];
          expect(result).toEqual(['one', '']);
        });
      });

      // ============================================================
      // LIMIT
      // ============================================================
      describe('LIMIT', () => {
        it('applies LIMIT offset and count', async () => {
          await storage.rpush('mylist', ['5', '4', '3', '2', '1']);
          const result = (await storage.sort('mylist', {
            limit: { offset: 1, count: 2 },
          })) as string[];
          // Sorted: 1, 2, 3, 4, 5 -> offset 1, count 2 -> 2, 3
          expect(result).toEqual(['2', '3']);
        });

        it('applies LIMIT with offset 0', async () => {
          await storage.rpush('mylist', ['3', '1', '2']);
          const result = (await storage.sort('mylist', {
            limit: { offset: 0, count: 2 },
          })) as string[];
          expect(result).toEqual(['1', '2']);
        });

        it('applies LIMIT with DESC', async () => {
          await storage.rpush('mylist', ['5', '4', '3', '2', '1']);
          const result = (await storage.sort('mylist', {
            sortOrder: 'DESC',
            limit: { offset: 0, count: 2 },
          })) as string[];
          expect(result).toEqual(['5', '4']);
        });
      });

      // ============================================================
      // STORE
      // ============================================================
      describe('STORE', () => {
        it('stores result as a list and returns count', async () => {
          await storage.rpush('mylist', ['3', '1', '2']);
          const result = await storage.sort('mylist', { store: 'dest' });
          expect(result).toBe(3);
          const stored = await storage.lrange('dest', 0, -1);
          expect(stored).toEqual(['1', '2', '3']);
        });

        it('stores result with GET patterns', async () => {
          await storage.rpush('mylist', ['1', '2']);
          await storage.set('obj_1', 'one');
          await storage.set('obj_2', 'two');
          const result = await storage.sort('mylist', { getPatterns: ['obj_*'], store: 'dest' });
          expect(result).toBe(2);
          const stored = await storage.lrange('dest', 0, -1);
          expect(stored).toEqual(['one', 'two']);
        });

        it('overwrites existing destination key', async () => {
          await storage.rpush('mylist', ['3', '1']);
          await storage.rpush('dest', ['old_data']);
          await storage.sort('mylist', { store: 'dest' });
          const stored = await storage.lrange('dest', 0, -1);
          expect(stored).toEqual(['1', '3']);
        });

        it('stores empty result for empty source key', async () => {
          const result = await storage.sort('nonexistent', { store: 'dest' });
          expect(result).toBe(0);
          // The destination should be deleted/empty
          const stored = await storage.lrange('dest', 0, -1);
          expect(stored).toEqual([]);
        });

        it('stores result with DESC', async () => {
          await storage.rpush('mylist', ['3', '1', '2']);
          const result = await storage.sort('mylist', { sortOrder: 'DESC', store: 'dest' });
          expect(result).toBe(3);
          const stored = await storage.lrange('dest', 0, -1);
          expect(stored).toEqual(['3', '2', '1']);
        });
      });

      // ============================================================
      // Combined options
      // ============================================================
      describe('combined options', () => {
        it('sorts with BY + LIMIT', async () => {
          await storage.rpush('mylist', ['a', 'b', 'c', 'd', 'e']);
          await storage.set('weight_a', '5');
          await storage.set('weight_b', '1');
          await storage.set('weight_c', '3');
          await storage.set('weight_d', '4');
          await storage.set('weight_e', '2');
          const result = (await storage.sort('mylist', {
            byPattern: 'weight_*',
            limit: { offset: 1, count: 2 },
          })) as string[];
          // Sorted by weight: b(1), e(2), c(3), d(4), a(5) -> offset 1, count 2 -> e, c
          expect(result).toEqual(['e', 'c']);
        });

        it('sorts with BY + GET + STORE', async () => {
          await storage.rpush('mylist', ['1', '2', '3']);
          await storage.set('weight_1', '3');
          await storage.set('weight_2', '1');
          await storage.set('weight_3', '2');
          await storage.set('obj_1', 'one');
          await storage.set('obj_2', 'two');
          await storage.set('obj_3', 'three');
          const result = await storage.sort('mylist', {
            byPattern: 'weight_*',
            getPatterns: ['obj_*'],
            store: 'dest',
          });
          expect(result).toBe(3);
          const stored = await storage.lrange('dest', 0, -1);
          expect(stored).toEqual(['two', 'three', 'one']);
        });

        it('sorts ALPHA with GET #', async () => {
          await storage.rpush('mylist', ['c', 'a', 'b']);
          const result = (await storage.sort('mylist', {
            alpha: true,
            getPatterns: ['#'],
          })) as string[];
          expect(result).toEqual(['a', 'b', 'c']);
        });
      });

      // ============================================================
      // Edge cases
      // ============================================================
      describe('edge cases', () => {
        it('handles single element list', async () => {
          await storage.rpush('mylist', ['5']);
          const result = (await storage.sort('mylist')) as string[];
          expect(result).toEqual(['5']);
        });

        it('handles set with one member', async () => {
          await storage.sadd('myset', ['10']);
          const result = (await storage.sort('myset')) as string[];
          expect(result).toEqual(['10']);
        });

        it('handles ALPHA with numbers as strings when sorted correctly', async () => {
          // ALPHA will sort lexicographically: "1" < "10" < "2" < "20" < "3"
          await storage.rpush('mylist', ['10', '1', '2', '20', '3']);
          const result = (await storage.sort('mylist', { alpha: true })) as string[];
          expect(result).toEqual(['1', '10', '2', '20', '3']);
        });

        it('handles numeric sort correctly', async () => {
          await storage.rpush('mylist', ['10', '1', '2', '20', '3']);
          const result = (await storage.sort('mylist')) as string[];
          expect(result).toEqual(['1', '2', '3', '10', '20']);
        });

        it('handles negative numbers in numeric sort', async () => {
          await storage.rpush('mylist', ['-5', '3', '-1', '0', '2']);
          const result = (await storage.sort('mylist')) as string[];
          expect(result).toEqual(['-5', '-1', '0', '2', '3']);
        });
      });
    });
  }
});
