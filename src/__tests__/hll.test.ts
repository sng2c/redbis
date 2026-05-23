import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import { PubSubManager } from '../pubsub/manager';

// ========================================
// InMemoryStorage HyperLogLog Tests
// ========================================

describe('HLL 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  // --- PFADD ---
  describe('PFADD 명령어', () => {
    it('새 키에 요소를 추가하면 1을 반환한다', async () => {
      const result = await handler.execute(['PFADD', 'myhll', 'a']);
      expect(result).toBe(':1\r\n');
    });

    it('동일한 요소를 재추가하면 0을 반환한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a']);
      const result = await handler.execute(['PFADD', 'myhll', 'a']);
      expect(result).toBe(':0\r\n');
    });

    it('새 요소를 추가하면 1을 반환한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a']);
      const result = await handler.execute(['PFADD', 'myhll', 'b']);
      expect(result).toBe(':1\r\n');
    });

    it('여러 요소를 한번에 추가할 수 있다', async () => {
      const result = await handler.execute(['PFADD', 'myhll', 'a', 'b', 'c']);
      expect(result).toBe(':1\r\n');
    });

    it('존재하는 키에 완전히 새로운 요소를 추가하면 1을 반환한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a', 'b']);
      const result = await handler.execute(['PFADD', 'myhll', 'c', 'd']);
      expect(result).toBe(':1\r\n');
    });

    it('해시 키에 PFADD을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['PFADD', 'myhash', 'a']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  // --- PFCOUNT ---
  describe('PFCOUNT 명령어', () => {
    it('단일 키의 카디널리티를 추정한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a', 'b', 'c']);
      const result = await handler.execute(['PFCOUNT', 'myhll']);
      // Parse the integer response
      expect(result).toMatch(/^:\d+\r\n$/);
      const count = parseInt(result.slice(1));
      expect(count).toBe(3);
    });

    it('존재하지 않는 키의 카디널리티는 0이다', async () => {
      const result = await handler.execute(['PFCOUNT', 'nokey']);
      expect(result).toBe(':0\r\n');
    });

    it('여러 키의 병합 카디널리티를 추정한다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a', 'b']);
      await handler.execute(['PFADD', 'hll2', 'c', 'd']);
      const result = await handler.execute(['PFCOUNT', 'hll1', 'hll2']);
      expect(result).toMatch(/^:\d+\r\n$/);
      const count = parseInt(result.slice(1));
      expect(count).toBe(4);
    });

    it('일부 키가 없어도 동작한다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a']);
      const result = await handler.execute(['PFCOUNT', 'hll1', 'nokey']);
      expect(result).toMatch(/^:\d+\r\n$/);
      const count = parseInt(result.slice(1));
      expect(count).toBe(1);
    });

    it('해시 키에 PFCOUNT을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['PFCOUNT', 'myhash']);
      expect(result).toContain('WRONGTYPE');
    });

    it('추정값이 실제값과 근사하게 일치한다', async () => {
      const elements: string[] = [];
      for (let i = 0; i < 100; i++) {
        elements.push(`element${i}`);
      }
      await handler.execute(['PFADD', 'myhll', ...elements]);
      const result = await handler.execute(['PFCOUNT', 'myhll']);
      const count = parseInt(result.slice(1).replace('\r\n', ''));
      expect(count).toBeGreaterThan(0);
      // HLL should be within 20% for 100 elements
      expect(Math.abs(count - 100) / 100).toBeLessThan(0.2);
    });
  });

  // --- PFMERGE ---
  describe('PFMERGE 명령어', () => {
    it('두 HLL을 병합할 수 있다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a', 'b']);
      await handler.execute(['PFADD', 'hll2', 'c', 'd']);
      await handler.execute(['PFMERGE', 'dest', 'hll1', 'hll2']);
      const result = await handler.execute(['PFCOUNT', 'dest']);
      const count = parseInt(result.slice(1).replace('\r\n', ''));
      expect(count).toBe(4);
    });

    it('대상 키가 없으면 새로 생성한다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a']);
      const result = await handler.execute(['PFMERGE', 'dest', 'hll1']);
      expect(result).toBe('+OK\r\n');
      const countResult = await handler.execute(['PFCOUNT', 'dest']);
      const count = parseInt(countResult.slice(1).replace('\r\n', ''));
      expect(count).toBe(1);
    });

    it('소스 키가 없으면 빈 HLL로 처리한다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a']);
      await handler.execute(['PFMERGE', 'dest', 'hll1', 'nokey']);
      const countResult = await handler.execute(['PFCOUNT', 'dest']);
      const count = parseInt(countResult.slice(1).replace('\r\n', ''));
      expect(count).toBe(1);
    });

    it('병합 후 PFCOUNT로 카디널리티를 확인할 수 있다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a', 'b', 'c']);
      await handler.execute(['PFADD', 'hll2', 'd', 'e']);
      await handler.execute(['PFMERGE', 'dest', 'hll1', 'hll2']);
      const countResult = await handler.execute(['PFCOUNT', 'dest']);
      const count = parseInt(countResult.slice(1).replace('\r\n', ''));
      expect(count).toBe(5);
    });

    it('self-merge도 동작한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a', 'b']);
      await handler.execute(['PFMERGE', 'myhll', 'myhll']);
      const countResult = await handler.execute(['PFCOUNT', 'myhll']);
      const count = parseInt(countResult.slice(1).replace('\r\n', ''));
      expect(count).toBe(2);
    });

    it('해시 키가 소스에 포함되면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['PFMERGE', 'dest', 'myhash']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  // --- Cross-type tests ---
  describe('HLL 교차 타입 테스트', () => {
    it('PFADD 후 TYPE 명령은 hyperloglog를 반환한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a']);
      const result = await handler.execute(['TYPE', 'myhll']);
      expect(result).toBe('+hyperloglog\r\n');
    });

    it('HSET 후 PFADD을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['PFADD', 'myhash', 'a']);
      expect(result).toContain('WRONGTYPE');
    });

    it('PFADD 후 GET은 HLL 데이터를 반환한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a']);
      const result = await handler.execute(['GET', 'myhll']);
      // Should return a bulk string (the HLL data), not null
      expect(result).not.toBe('$-1\r\n');
    });

    it('PFMERGE 후 TYPE 명령은 hyperloglog를 반환한다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a']);
      await handler.execute(['PFMERGE', 'dest', 'hll1']);
      const result = await handler.execute(['TYPE', 'dest']);
      expect(result).toBe('+hyperloglog\r\n');
    });
  });

  // --- Accuracy tests ---
  describe('HLL 정확도 테스트', () => {
    it('100개의 고유 요소에 대한 추정값이 ±20% 오차 내에 있다', async () => {
      for (let i = 0; i < 100; i++) {
        await handler.execute(['PFADD', 'myhll', `elem${i}`]);
      }
      const result = await handler.execute(['PFCOUNT', 'myhll']);
      const count = parseInt(result.slice(1).replace('\r\n', ''));
      expect(count).toBeGreaterThan(0);
      expect(Math.abs(count - 100) / 100).toBeLessThan(0.2);
    });

    it('1000개의 고유 요소에 대한 추정값이 ±5% 오차 내에 있다', async () => {
      // Add in batches for efficiency
      for (let i = 0; i < 10; i++) {
        const batch: string[] = [];
        for (let j = 0; j < 100; j++) {
          batch.push(`element_${i * 100 + j}`);
        }
        await handler.execute(['PFADD', 'myhll2', ...batch]);
      }
      const result = await handler.execute(['PFCOUNT', 'myhll2']);
      const count = parseInt(result.slice(1).replace('\r\n', ''));
      expect(count).toBeGreaterThan(0);
      expect(Math.abs(count - 1000) / 1000).toBeLessThan(0.05);
    });
  });
});

// ========================================
// SqliteStorage HyperLogLog Tests
// ========================================

describe('HLL 명령어 — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  // --- PFADD ---
  describe('PFADD 명령어', () => {
    it('새 키에 요소를 추가하면 1을 반환한다', async () => {
      const result = await handler.execute(['PFADD', 'myhll', 'a']);
      expect(result).toBe(':1\r\n');
    });

    it('동일한 요소를 재추가하면 0을 반환한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a']);
      const result = await handler.execute(['PFADD', 'myhll', 'a']);
      expect(result).toBe(':0\r\n');
    });

    it('새 요소를 추가하면 1을 반환한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a']);
      const result = await handler.execute(['PFADD', 'myhll', 'b']);
      expect(result).toBe(':1\r\n');
    });

    it('해시 키에 PFADD을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['PFADD', 'myhash', 'a']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  // --- PFCOUNT ---
  describe('PFCOUNT 명령어', () => {
    it('단일 키의 카디널리티를 추정한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a', 'b', 'c']);
      const result = await handler.execute(['PFCOUNT', 'myhll']);
      const count = parseInt(result.slice(1).replace('\r\n', ''));
      expect(count).toBe(3);
    });

    it('존재하지 않는 키의 카디널리티는 0이다', async () => {
      const result = await handler.execute(['PFCOUNT', 'nokey']);
      expect(result).toBe(':0\r\n');
    });

    it('여러 키의 병합 카디널리티를 추정한다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a', 'b']);
      await handler.execute(['PFADD', 'hll2', 'c', 'd']);
      const result = await handler.execute(['PFCOUNT', 'hll1', 'hll2']);
      const count = parseInt(result.slice(1).replace('\r\n', ''));
      expect(count).toBe(4);
    });
  });

  // --- PFMERGE ---
  describe('PFMERGE 명령어', () => {
    it('두 HLL을 병합할 수 있다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a', 'b']);
      await handler.execute(['PFADD', 'hll2', 'c', 'd']);
      await handler.execute(['PFMERGE', 'dest', 'hll1', 'hll2']);
      const result = await handler.execute(['PFCOUNT', 'dest']);
      const count = parseInt(result.slice(1).replace('\r\n', ''));
      expect(count).toBe(4);
    });

    it('대상 키가 없으면 새로 생성한다', async () => {
      await handler.execute(['PFADD', 'hll1', 'a']);
      const result = await handler.execute(['PFMERGE', 'dest', 'hll1']);
      expect(result).toBe('+OK\r\n');
    });
  });

  // --- Cross-type tests ---
  describe('HLL 교차 타입 테스트', () => {
    it('PFADD 후 TYPE 명령은 hyperloglog를 반환한다', async () => {
      await handler.execute(['PFADD', 'myhll', 'a']);
      const result = await handler.execute(['TYPE', 'myhll']);
      expect(result).toBe('+hyperloglog\r\n');
    });

    it('HSET 후 PFADD을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['PFADD', 'myhash', 'a']);
      expect(result).toContain('WRONGTYPE');
    });
  });
});
