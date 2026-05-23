import { describe, it, expect, beforeEach } from 'vitest';
import {
  slowLog,
  recordSlowLog,
  SLOWLOG_MAX,
  SLOWLOG_SLOW_THRESHOLD,
} from '../command/slowlog';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { PubSubManager } from '../pubsub/manager';

describe('SlowLog', () => {
  beforeEach(() => {
    slowLog.length = 0;
  });

  describe('recordSlowLog', () => {
    it('임계값 미만 명령은 로그에 기록되지 않는다', () => {
      recordSlowLog(['GET', 'key'], SLOWLOG_SLOW_THRESHOLD - 1);
      expect(slowLog.length).toBe(0);
    });

    it('임계값과 같은 지속시간은 로그에 기록된다', () => {
      recordSlowLog(['GET', 'key'], SLOWLOG_SLOW_THRESHOLD);
      expect(slowLog.length).toBe(1);
    });

    it('임계값 이상 명령은 로그에 기록된다', () => {
      recordSlowLog(['GET', 'key'], 15);
      expect(slowLog.length).toBe(1);
    });

    it('기록된 항목의 필드가 올바르다', () => {
      const before = Date.now();
      recordSlowLog(['GET', 'key'], 15);
      const after = Date.now();

      expect(slowLog).toHaveLength(1);
      const entry = slowLog[0];
      expect(entry.command).toEqual(['GET', 'key']);
      expect(entry.duration).toBe(15);
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
    });

    it('여러 명령을 기록하면 ID가 단조 증가한다', () => {
      recordSlowLog(['GET', 'a'], 20);
      recordSlowLog(['SET', 'b', 'val'], 25);

      expect(slowLog).toHaveLength(2);
      expect(slowLog[1].id).toBeGreaterThan(slowLog[0].id);
    });

    it('최대 항목 수를 초과하면 가장 오래된 항목이 제거된다', () => {
      // Fill up to the max
      for (let i = 0; i < SLOWLOG_MAX; i++) {
        recordSlowLog(['CMD', `key${i}`], 10 + i);
      }
      expect(slowLog.length).toBe(SLOWLOG_MAX);

      // Add one more — oldest should be evicted
      recordSlowLog(['CMD', 'overflow'], 999);
      expect(slowLog.length).toBe(SLOWLOG_MAX);

      // The first inserted entry should have been removed
      expect(slowLog[0].command).not.toEqual(['CMD', 'key0']);
      // The latest entry should be the overflow one
      expect(slowLog[slowLog.length - 1].command).toEqual(['CMD', 'overflow']);
    });

    it('지속시간이 0이면 기록되지 않는다', () => {
      recordSlowLog(['PING'], 0);
      expect(slowLog.length).toBe(0);
    });
  });

  describe('SLOWLOG 명령어 (CommandHandler)', () => {
    let storage: InMemoryStorage;
    let pubsub: PubSubManager;
    let handler: CommandHandler;

    beforeEach(() => {
      storage = new InMemoryStorage();
      pubsub = new PubSubManager();
      handler = new CommandHandler(storage, pubsub, 'test-conn', () => {});
    });

    it('SLOWLOG GET — 슬로우로그 조회', async () => {
      // Populate slowLog directly since normal commands are too fast
      recordSlowLog(['GET', 'mykey'], 50);

      const result = await handler.execute(['SLOWLOG', 'GET']);
      // Should contain the entry
      expect(result).toContain('*1'); // 1 entry in the outer array
      expect(result).toContain('GET');
      expect(result).toContain('mykey');
    });

    it('SLOWLOG GET count — 개수 제한 조회', async () => {
      recordSlowLog(['GET', 'a'], 50);
      recordSlowLog(['SET', 'b', 'val'], 60);

      const result = await handler.execute(['SLOWLOG', 'GET', '1']);
      // Should return only 1 entry (the most recent)
      expect(result).toContain('*1');
      expect(result).toContain('SET');
    });

    it('SLOWLOG LEN — 슬로우로그 길이', async () => {
      recordSlowLog(['GET', 'x'], 30);

      const result = await handler.execute(['SLOWLOG', 'LEN']);
      // slowLog has 1 entry
      expect(result).toBe(':1\r\n');
    });

    it('SLOWLOG LEN — 슬로우로그가 비어있으면 0', async () => {
      const result = await handler.execute(['SLOWLOG', 'LEN']);
      expect(result).toBe(':0\r\n');
    });

    it('SLOWLOG RESET — 슬로우로그 초기화', async () => {
      recordSlowLog(['GET', 'y'], 40);
      expect(slowLog.length).toBe(1);

      const result = await handler.execute(['SLOWLOG', 'RESET']);
      expect(result).toContain('+OK');
      expect(slowLog.length).toBe(0);
    });

    it('SLOWLOG RESET 후 LEN은 0이 된다', async () => {
      recordSlowLog(['GET', 'z'], 100);
      recordSlowLog(['SET', 'z', '1'], 200);
      expect(slowLog.length).toBe(2);

      await handler.execute(['SLOWLOG', 'RESET']);
      const result = await handler.execute(['SLOWLOG', 'LEN']);
      expect(result).toBe(':0\r\n');
    });

    it('SLOWLOG — 알 수 없는 하위 명령어', async () => {
      const result = await handler.execute(['SLOWLOG', 'UNKNOWN']);
      expect(result).toContain('-ERR');
    });

    it('SLOWLOG GET — 빈 로그 조회', async () => {
      const result = await handler.execute(['SLOWLOG', 'GET']);
      expect(result).toContain('*0');
    });
  });
});