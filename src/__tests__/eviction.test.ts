import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import { PubSubManager } from '../pubsub/manager';
import { CommandHandler } from '../command/handler';

const storageProviders = [
  { name: 'InMemoryStorage', create: () => new InMemoryStorage() },
  { name: 'SqliteStorage', create: () => new SqliteStorage({ path: ':memory:' }) },
];

for (const { name, create } of storageProviders) {
  describe(`키 만료 스윕 — ${name}`, () => {
    let storage: InMemoryStorage | SqliteStorage;
    let handler: CommandHandler;

    beforeEach(() => {
      vi.useFakeTimers();
      storage = create();
      handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // ========================================================
    // Per-key lazy eviction (evictIfExpired)
    // ========================================================
    describe('per-key lazy eviction', () => {
      it('만료된 키를 조회하면 null을 반환한다', async () => {
        await handler.execute(['SET', 'mykey', 'value', 'EX', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['GET', 'mykey']);
        expect(result).toBe('$-1\r\n');
      });

      it('만료된 키를 삭제하면 0을 반환한다', async () => {
        await handler.execute(['SET', 'mykey', 'value', 'EX', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['DEL', 'mykey']);
        expect(result).toBe(':0\r\n');
      });

      it('만료된 키의 타입은 none이다', async () => {
        await handler.execute(['SET', 'mykey', 'value', 'EX', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['TYPE', 'mykey']);
        expect(result).toBe('+none\r\n');
      });

      it('만료되지 않은 키는 정상 조회된다', async () => {
        await handler.execute(['SET', 'mykey', 'value', 'EX', '100']);
        // Do not advance time past expiry
        const result = await handler.execute(['GET', 'mykey']);
        expect(result).toBe('$5\r\nvalue\r\n');
      });
    });

    // ========================================================
    // evictAllExpired sweep
    // ========================================================
    describe('evictAllExpired 스윕', () => {
      it('evictAllExpired — 만료된 모든 키를 제거한다', async () => {
        await handler.execute(['SET', 'key1', 'val1', 'EX', '10']);
        await handler.execute(['SET', 'key2', 'val2', 'EX', '10']);
        await handler.execute(['SET', 'key3', 'val3']); // no expiry
        vi.advanceTimersByTime(11000);
        // KEYS * internally calls evictAllExpired for both storages
        const result = await handler.execute(['KEYS', '*']);
        expect(result).toContain('key3');
        expect(result).not.toContain('key1');
        expect(result).not.toContain('key2');
      });

      it('evictAllExpired — 만료된 리스트 키도 제거한다', async () => {
        await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
        await handler.execute(['EXPIRE', 'mylist', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['TYPE', 'mylist']);
        expect(result).toBe('+none\r\n');
      });

      it('evictAllExpired — 만료된 해시 키도 제거한다', async () => {
        await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
        await handler.execute(['EXPIRE', 'myhash', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['TYPE', 'myhash']);
        expect(result).toBe('+none\r\n');
      });

      it('evictAllExpired — 만료된 셋 키도 제거한다', async () => {
        await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
        await handler.execute(['EXPIRE', 'myset', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['TYPE', 'myset']);
        expect(result).toBe('+none\r\n');
      });

      it('evictAllExpired — 만료된 정렬 셋 키도 제거한다', async () => {
        await handler.execute(['ZADD', 'myzset', '1', 'a', '2', 'b']);
        await handler.execute(['EXPIRE', 'myzset', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['TYPE', 'myzset']);
        expect(result).toBe('+none\r\n');
      });

      it('evictAllExpired — 만료된 문자열 키가 제거된다', async () => {
        await handler.execute(['SET', 'mykey', 'val', 'EX', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['GET', 'mykey']);
        expect(result).toBe('$-1\r\n');
      });
    });

    // ========================================================
    // TTL behavior
    // ========================================================
    describe('TTL 동작', () => {
      it('TTL — 만료 시간이 설정된 키의 TTL을 조회한다', async () => {
        await handler.execute(['SET', 'mykey', 'value', 'EX', '100']);
        const result = await handler.execute(['TTL', 'mykey']);
        // TTL should be a positive integer ≤ 100
        const match = result.match(/^:(\d+)\r\n$/);
        expect(match).not.toBeNull();
        const ttl = parseInt(match![1], 10);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(100);
      });

      it('TTL — 만료 시간이 없는 키는 -1을 반환한다', async () => {
        await handler.execute(['SET', 'mykey', 'value']);
        const result = await handler.execute(['TTL', 'mykey']);
        expect(result).toBe(':-1\r\n');
      });

      it('TTL — 존재하지 않는 키는 -2를 반환한다', async () => {
        const result = await handler.execute(['TTL', 'nokey']);
        expect(result).toBe(':-2\r\n');
      });

      it('PERSIST — 만료 시간을 제거한다', async () => {
        await handler.execute(['SET', 'mykey', 'value', 'EX', '100']);
        await handler.execute(['PERSIST', 'mykey']);
        const result = await handler.execute(['TTL', 'mykey']);
        expect(result).toBe(':-1\r\n');
      });
    });

    // ========================================================
    // Edge cases
    // ========================================================
    describe('엣지 케이스', () => {
      it('만료 경계에서 정확히 만료 시간에 도달하면 키가 만료된다', async () => {
        await handler.execute(['SET', 'mykey', 'value', 'EX', '10']);
        // Advance exactly 10 seconds — should be expired (≥ check)
        vi.advanceTimersByTime(10000);
        const result = await handler.execute(['GET', 'mykey']);
        expect(result).toBe('$-1\r\n');
      });

      it('KEYS 명령이 만료된 키를 포함하지 않는다', async () => {
        await handler.execute(['SET', 'key1', 'val1', 'EX', '10']);
        await handler.execute(['SET', 'key2', 'val2']); // no expiry
        await handler.execute(['SET', 'key3', 'val3', 'EX', '10']);
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['KEYS', '*']);
        // key2 should be the only one left
        expect(result).toContain('key2');
        expect(result).not.toContain('key1');
        expect(result).not.toContain('key3');
      });

      it('EXPIRE로 별도 설정한 만료 시간도 정상 동작한다', async () => {
        await handler.execute(['SET', 'mykey', 'value']);
        await handler.execute(['EXPIRE', 'mykey', '5']);
        vi.advanceTimersByTime(6000);
        const result = await handler.execute(['GET', 'mykey']);
        expect(result).toBe('$-1\r\n');
      });

      it('DBSIZE가 만료된 키를 제외한다', async () => {
        await handler.execute(['SET', 'key1', 'val1', 'EX', '10']);
        await handler.execute(['SET', 'key2', 'val2']); // no expiry
        vi.advanceTimersByTime(11000);
        const result = await handler.execute(['DBSIZE']);
        // Only key2 should remain
        expect(result).toBe(':1\r\n');
      });
    });
  });
}