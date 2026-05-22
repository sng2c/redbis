import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import { PubSubManager } from '../pubsub/manager';

// Helper to parse RESP array from string
function parseRespArray(resp: string): string[] {
  const lines = resp.split('\r\n');
  const results: string[] = [];
  let i = 0;
  // First line should be *<count>
  if (!lines[i] || !lines[i].startsWith('*')) return results;
  i++;
  while (i < lines.length) {
    if (lines[i].startsWith('$')) {
      const len = parseInt(lines[i].slice(1));
      i++;
      if (len >= 0 && lines[i] !== undefined) {
        results.push(lines[i]);
      } else if (len === -1) {
        results.push('__NULL__');
      }
      i++;
    } else {
      i++;
    }
  }
  return results;
}

// ========================================
// InMemoryStorage SORT Tests
// ========================================

describe('SORT command — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('Basic sort of LIST', () => {
    it('sorts a list of numbers in ascending order', async () => {
      await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
      const result = await handler.execute(['SORT', 'mylist']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['1', '2', '3']);
    });

    it('sorts a list with DESC', async () => {
      await handler.execute(['RPUSH', 'mylist', '1', '3', '2']);
      const result = await handler.execute(['SORT', 'mylist', 'DESC']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['3', '2', '1']);
    });

    it('sorts with ALPHA for lexicographic order', async () => {
      await handler.execute(['RPUSH', 'mylist', 'c', 'a', 'b']);
      const result = await handler.execute(['SORT', 'mylist', 'ALPHA']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['a', 'b', 'c']);
    });

    it('sorts with ALPHA DESC', async () => {
      await handler.execute(['RPUSH', 'mylist', 'c', 'a', 'b']);
      const result = await handler.execute(['SORT', 'mylist', 'ALPHA', 'DESC']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['c', 'b', 'a']);
    });
  });

  describe('SORT on SET', () => {
    it('sorts a set of numbers', async () => {
      await handler.execute(['SADD', 'myset', '3', '1', '2']);
      const result = await handler.execute(['SORT', 'myset']);
      const parsed = parseRespArray(result);
      // Set order is non-deterministic in input, but sort should order them
      expect(parsed.sort((a, b) => Number(a) - Number(b))).toEqual(['1', '2', '3']);
      expect(parsed).toEqual(['1', '2', '3']);
    });
  });

  describe('SORT on ZSET', () => {
    it('sorts a sorted set by member values', async () => {
      await handler.execute(['ZADD', 'myzset', '10', '3', '20', '1', '30', '2']);
      const result = await handler.execute(['SORT', 'myzset']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['1', '2', '3']);
    });
  });

  describe('SORT with BY pattern', () => {
    it('sorts by external key weights', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      await handler.execute(['SET', 'weight_a', '3']);
      await handler.execute(['SET', 'weight_b', '1']);
      await handler.execute(['SET', 'weight_c', '2']);
      const result = await handler.execute(['SORT', 'mylist', 'BY', 'weight_*']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['b', 'c', 'a']);
    });
  });

  describe('SORT with GET pattern', () => {
    it('sorts and retrieves values via GET pattern', async () => {
      await handler.execute(['RPUSH', 'mylist', '1', '2', '3']);
      await handler.execute(['SET', 'name_1', 'alice']);
      await handler.execute(['SET', 'name_2', 'bob']);
      await handler.execute(['SET', 'name_3', 'charlie']);
      const result = await handler.execute(['SORT', 'mylist', 'GET', 'name_*']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['alice', 'bob', 'charlie']);
    });

    it('GET # returns the original element', async () => {
      await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
      const result = await handler.execute(['SORT', 'mylist', 'GET', '#']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['1', '2', '3']);
    });

    it('multiple GET patterns', async () => {
      await handler.execute(['RPUSH', 'mylist', '1', '2']);
      await handler.execute(['SET', 'name_1', 'alice']);
      await handler.execute(['SET', 'name_2', 'bob']);
      await handler.execute(['SET', 'age_1', '30']);
      await handler.execute(['SET', 'age_2', '25']);
      const result = await handler.execute(['SORT', 'mylist', 'GET', 'name_*', 'GET', 'age_*']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['alice', '30', 'bob', '25']);
    });
  });

  describe('SORT with LIMIT', () => {
    it('applies LIMIT offset count', async () => {
      await handler.execute(['RPUSH', 'mylist', '5', '4', '3', '2', '1']);
      const result = await handler.execute(['SORT', 'mylist', 'LIMIT', '1', '3']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['2', '3', '4']);
    });

    it('applies LIMIT with DESC', async () => {
      await handler.execute(['RPUSH', 'mylist', '1', '2', '3', '4', '5']);
      const result = await handler.execute(['SORT', 'mylist', 'DESC', 'LIMIT', '0', '3']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['5', '4', '3']);
    });

    it('applies LIMIT with ALPHA and DESC', async () => {
      await handler.execute(['RPUSH', 'mylist', 'e', 'd', 'c', 'b', 'a']);
      const result = await handler.execute(['SORT', 'mylist', 'ALPHA', 'DESC', 'LIMIT', '1', '2']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['d', 'c']);
    });
  });

  describe('SORT with STORE', () => {
    it('stores result to destination key', async () => {
      await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
      const result = await handler.execute(['SORT', 'mylist', 'STORE', 'dest']);
      // Should return integer count
      expect(result).toBe(':3\r\n');

      // Verify stored as list
      const stored = await handler.execute(['LRANGE', 'dest', '0', '-1']);
      const parsed = parseRespArray(stored);
      expect(parsed).toEqual(['1', '2', '3']);
    });
  });

  describe('Nonexistent key', () => {
    it('returns empty array for nonexistent key', async () => {
      const result = await handler.execute(['SORT', 'nonexistent']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('Wrong type error', () => {
    it('returns WRONGTYPE error for string key', async () => {
      await handler.execute(['SET', 'mystr', 'hello']);
      const result = await handler.execute(['SORT', 'mystr']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('Numeric sort with non-numeric values without ALPHA', () => {
    it('returns error for non-numeric values without ALPHA flag', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['SORT', 'mylist']);
      expect(result).toContain('ERR');
    });
  });

  describe('SORT with BY and GET combined', () => {
    it('sorts by external weights and gets values', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      await handler.execute(['SET', 'weight_a', '30']);
      await handler.execute(['SET', 'weight_b', '10']);
      await handler.execute(['SET', 'weight_c', '20']);
      await handler.execute(['SET', 'name_a', 'alice']);
      await handler.execute(['SET', 'name_b', 'bob']);
      await handler.execute(['SET', 'name_c', 'charlie']);
      const result = await handler.execute(['SORT', 'mylist', 'BY', 'weight_*', 'GET', 'name_*']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['bob', 'charlie', 'alice']);
    });
  });
});

// ========================================
// SORT_RO command — InMemoryStorage
// ========================================

describe('SORT_RO command — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  it('SORT_RO works like SORT without STORE', async () => {
    await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
    const result = await handler.execute(['SORT_RO', 'mylist']);
    const parsed = parseRespArray(result);
    expect(parsed).toEqual(['1', '2', '3']);
  });

  it('SORT_RO with STORE returns error', async () => {
    await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
    const result = await handler.execute(['SORT_RO', 'mylist', 'STORE', 'dest']);
    expect(result).toContain("SORT_RO can't be used with STORE option");
  });

  it('SORT_RO with ALPHA', async () => {
    await handler.execute(['RPUSH', 'mylist', 'c', 'a', 'b']);
    const result = await handler.execute(['SORT_RO', 'mylist', 'ALPHA']);
    const parsed = parseRespArray(result);
    expect(parsed).toEqual(['a', 'b', 'c']);
  });

  it('SORT_RO with DESC', async () => {
    await handler.execute(['RPUSH', 'mylist', '1', '3', '2']);
    const result = await handler.execute(['SORT_RO', 'mylist', 'DESC']);
    const parsed = parseRespArray(result);
    expect(parsed).toEqual(['3', '2', '1']);
  });
});

// ========================================
// SORT in MULTI/EXEC transaction — InMemoryStorage
// ========================================

describe('SORT in MULTI/EXEC — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  it('SORT works inside MULTI/EXEC transaction', async () => {
    await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
    await handler.execute(['MULTI']);
    const queued1 = await handler.execute(['SORT', 'mylist']);
    expect(queued1).toBe('+QUEUED\r\n');
    const results = await handler.execute(['EXEC']);
    // EXEC returns array of results
    expect(results).toContain('1');
    expect(results).toContain('2');
    expect(results).toContain('3');
  });
});

// ========================================
// SqliteStorage SORT Tests
// ========================================

describe('SORT command — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(async () => {
    const storage = new SqliteStorage({ path: ':memory:' });
    await storage.initialize?.();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('Basic sort of LIST', () => {
    it('sorts a list of numbers in ascending order', async () => {
      await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
      const result = await handler.execute(['SORT', 'mylist']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['1', '2', '3']);
    });

    it('sorts with DESC', async () => {
      await handler.execute(['RPUSH', 'mylist', '1', '3', '2']);
      const result = await handler.execute(['SORT', 'mylist', 'DESC']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['3', '2', '1']);
    });

    it('sorts with ALPHA', async () => {
      await handler.execute(['RPUSH', 'mylist', 'c', 'a', 'b']);
      const result = await handler.execute(['SORT', 'mylist', 'ALPHA']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['a', 'b', 'c']);
    });

    it('sorts with ALPHA DESC', async () => {
      await handler.execute(['RPUSH', 'mylist', 'c', 'a', 'b']);
      const result = await handler.execute(['SORT', 'mylist', 'ALPHA', 'DESC']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['c', 'b', 'a']);
    });
  });

  describe('SORT with STORE', () => {
    it('stores result to destination key', async () => {
      await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
      const result = await handler.execute(['SORT', 'mylist', 'STORE', 'dest']);
      expect(result).toBe(':3\r\n');

      const stored = await handler.execute(['LRANGE', 'dest', '0', '-1']);
      const parsed = parseRespArray(stored);
      expect(parsed).toEqual(['1', '2', '3']);
    });
  });

  describe('SORT on SET', () => {
    it('sorts a set of numbers', async () => {
      await handler.execute(['SADD', 'myset', '3', '1', '2']);
      const result = await handler.execute(['SORT', 'myset']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['1', '2', '3']);
    });
  });

  describe('SORT on ZSET', () => {
    it('sorts a sorted set by member values', async () => {
      await handler.execute(['ZADD', 'myzset', '10', '3', '20', '1', '30', '2']);
      const result = await handler.execute(['SORT', 'myzset']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['1', '2', '3']);
    });
  });

  describe('SORT with BY and GET', () => {
    it('sorts by external weights and gets values', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      await handler.execute(['SET', 'weight_a', '30']);
      await handler.execute(['SET', 'weight_b', '10']);
      await handler.execute(['SET', 'weight_c', '20']);
      await handler.execute(['SET', 'name_a', 'alice']);
      await handler.execute(['SET', 'name_b', 'bob']);
      await handler.execute(['SET', 'name_c', 'charlie']);
      const result = await handler.execute(['SORT', 'mylist', 'BY', 'weight_*', 'GET', 'name_*']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['bob', 'charlie', 'alice']);
    });
  });

  describe('SORT with LIMIT', () => {
    it('applies LIMIT offset count', async () => {
      await handler.execute(['RPUSH', 'mylist', '5', '4', '3', '2', '1']);
      const result = await handler.execute(['SORT', 'mylist', 'LIMIT', '1', '3']);
      const parsed = parseRespArray(result);
      expect(parsed).toEqual(['2', '3', '4']);
    });
  });

  describe('Nonexistent key', () => {
    it('returns empty array for nonexistent key', async () => {
      const result = await handler.execute(['SORT', 'nonexistent']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('Wrong type error', () => {
    it('returns WRONGTYPE error for string key', async () => {
      await handler.execute(['SET', 'mystr', 'hello']);
      const result = await handler.execute(['SORT', 'mystr']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('Numeric sort with non-numeric values without ALPHA', () => {
    it('returns error for non-numeric values without ALPHA flag', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['SORT', 'mylist']);
      expect(result).toContain('ERR');
    });
  });
});

describe('SORT_RO command — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(async () => {
    const storage = new SqliteStorage({ path: ':memory:' });
    await storage.initialize?.();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  it('SORT_RO works like SORT without STORE', async () => {
    await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
    const result = await handler.execute(['SORT_RO', 'mylist']);
    const parsed = parseRespArray(result);
    expect(parsed).toEqual(['1', '2', '3']);
  });

  it('SORT_RO with STORE returns error', async () => {
    await handler.execute(['RPUSH', 'mylist', '3', '1', '2']);
    const result = await handler.execute(['SORT_RO', 'mylist', 'STORE', 'dest']);
    expect(result).toContain("SORT_RO can't be used with STORE option");
  });
});