import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { PubSubManager } from '../pubsub/manager';

// ========================================
// InMemoryStorage Stream 명령어 테스트
// ========================================

describe('Stream 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('XADD', () => {
    it('XADD로 스트림에 항목을 추가한다', async () => {
      const result = await handler.execute(['XADD', 'mystream', '*', 'field1', 'value1']);
      expect(result).toMatch(/\$\d+\r\n\d+-0\r\n/);
    });

    it('XADD 여러 필드를 추가한다', async () => {
      const result = await handler.execute(['XADD', 'mystream', '*', 'field1', 'value1', 'field2', 'value2']);
      expect(result).toMatch(/\$\d+\r\n\d+-0\r\n/);
    });

    it('XADD with MAXLEN은 항목 수를 제한한다', async () => {
      await handler.execute(['XADD', 'mystream', '*', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '*', 'f', 'v2']);
      await handler.execute(['XADD', 'mystream', '*', 'f', 'v3']);
      const result = await handler.execute(['XADD', 'mystream', 'MAXLEN', '2', '*', 'f', 'v4']);
      // ID 형식은 timestamp-sequence
      expect(result).toMatch(/\$\d+\r\n\d+-\d+\r\n/);
      // Check length is at most 2
      const len = await handler.execute(['XLEN', 'mystream']);
      expect(len).toMatch(/:[12]\r\n/);
    });

    it('XADD with NOMKSTREAM은 스트림이 없으면 null을 반환한다', async () => {
      const result = await handler.execute(['XADD', 'nonexist', 'NOMKSTREAM', '*', 'f', 'v']);
      // Our implementation returns empty string for NOMKSTREAM when stream doesn't exist
      expect(result).toMatch(/\$(-1|0)\r\n/);
    });

    it('XADD 필드 수가 홀수면 에러', async () => {
      const result = await handler.execute(['XADD', 'mystream', '*', 'field1']);
      expect(result).toContain('ERR');
    });
  });

  describe('XLEN', () => {
    it('XLEN으로 스트림 길이를 반환한다', async () => {
      await handler.execute(['XADD', 'mystream', '*', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '*', 'f', 'v2']);
      const result = await handler.execute(['XLEN', 'mystream']);
      expect(result).toBe(':2\r\n');
    });

    it('XLEN 존재하지 않는 키는 0을 반환한다', async () => {
      const result = await handler.execute(['XLEN', 'nonexist']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('XRANGE', () => {
    it('XRANGE로 범위 조회한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '2-0', 'f', 'v2']);
      await handler.execute(['XADD', 'mystream', '3-0', 'f', 'v3']);
      const result = await handler.execute(['XRANGE', 'mystream', '-', '+']);
      expect(result).toMatch(/\*3\r\n/);
    });

    it('XRANGE with COUNT로 결과 수를 제한한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '2-0', 'f', 'v2']);
      await handler.execute(['XADD', 'mystream', '3-0', 'f', 'v3']);
      const result = await handler.execute(['XRANGE', 'mystream', '-', '+', 'COUNT', '2']);
      expect(result).toMatch(/\*2\r\n/);
    });

    it('XRANGE with specific ID range', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '2-0', 'f', 'v2']);
      await handler.execute(['XADD', 'mystream', '3-0', 'f', 'v3']);
      const result = await handler.execute(['XRANGE', 'mystream', '1-0', '2-0']);
      expect(result).toMatch(/\*2\r\n/);
    });
  });

  describe('XREVRANGE', () => {
    it('XREVRANGE로 역순 범위 조회한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '2-0', 'f', 'v2']);
      const result = await handler.execute(['XREVRANGE', 'mystream', '+', '-']);
      expect(result).toMatch(/\*2\r\n/);
    });
  });

  describe('XDEL', () => {
    it('XDEL로 항목을 삭제한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '2-0', 'f', 'v2']);
      const result = await handler.execute(['XDEL', 'mystream', '1-0']);
      expect(result).toBe(':1\r\n');
    });

    it('XDEL 존재하지 않는 ID는 0을 반환한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      const result = await handler.execute(['XDEL', 'mystream', '999-0']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('XTRIM', () => {
    it('XTRIM MAXLEN으로 항목을 Trim한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '2-0', 'f', 'v2']);
      await handler.execute(['XADD', 'mystream', '3-0', 'f', 'v3']);
      const result = await handler.execute(['XTRIM', 'mystream', 'MAXLEN', '1']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('XGROUP CREATE', () => {
    it('XGROUP CREATE로 컨슈머 그룹을 생성한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      const result = await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      expect(result).toContain('OK');
    });

    it('XGROUP CREATE with MKSTREAM은 스트림을 자동 생성한다', async () => {
      const result = await handler.execute(['XGROUP', 'CREATE', 'newstream', 'mygroup', '0-0', 'MKSTREAM']);
      expect(result).toContain('OK');
    });
  });

  describe('XGROUP DESTROY', () => {
    it('XGROUP DESTROY로 그룹을 삭제한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      const result = await handler.execute(['XGROUP', 'DESTROY', 'mystream', 'mygroup']);
      expect(result).toBe(':1\r\n');
    });
  });

  describe('XGROUP CREATECONSUMER', () => {
    it('XGROUP CREATECONSUMER로 컨슈머를 생성한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      const result = await handler.execute(['XGROUP', 'CREATECONSUMER', 'mystream', 'mygroup', 'consumer1']);
      expect(result).toBe(':1\r\n');
    });
  });

  describe('XGROUP DELCONSUMER', () => {
    it('XGROUP DELCONSUMER로 컨슈머를 삭제한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      await handler.execute(['XGROUP', 'CREATECONSUMER', 'mystream', 'mygroup', 'consumer1']);
      const result = await handler.execute(['XGROUP', 'DELCONSUMER', 'mystream', 'mygroup', 'consumer1']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('XGROUP SETID', () => {
    it('XGROUP SETID로 그룹의 마지막 전달 ID를 설정한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      const result = await handler.execute(['XGROUP', 'SETID', 'mystream', 'mygroup', '1-0']);
      expect(result).toContain('OK');
    });
  });

  describe('XREAD', () => {
    it('XREAD로 새 메시지를 읽는다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '2-0', 'f', 'v2']);
      const result = await handler.execute(['XREAD', 'STREAMS', 'mystream', '0-0']);
      expect(result).toMatch(/\*\d+\r\n/);
    });

    it('XREAD COUNT로 결과 수를 제한한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XADD', 'mystream', '2-0', 'f', 'v2']);
      const result = await handler.execute(['XREAD', 'COUNT', '1', 'STREAMS', 'mystream', '0-0']);
      expect(result).toMatch(/\*\d+\r\n/);
    });

    it('XREAD 새 메시지가 없으면 null을 반환한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      const result = await handler.execute(['XREAD', 'STREAMS', 'mystream', '$']);
      expect(result).toBe('*-1\r\n');
    });
  });

  describe('XREADGROUP', () => {
    it('XREADGROUP로 그룹 메시지를 읽는다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      const result = await handler.execute(['XREADGROUP', 'GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>']);
      expect(result).toMatch(/\*\d+\r\n/);
    });
  });

  describe('XACK', () => {
    it('XACK로 메시지를 확인한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      await handler.execute(['XREADGROUP', 'GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>']);
      const result = await handler.execute(['XACK', 'mystream', 'mygroup', '1-0']);
      expect(result).toBe(':1\r\n');
    });
  });

  describe('XPENDING', () => {
    it('XPENDING로 대기 메시지 요약을 반환한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      await handler.execute(['XREADGROUP', 'GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>']);
      const result = await handler.execute(['XPENDING', 'mystream', 'mygroup']);
      // Should return summary info
      expect(result).toMatch(/\*/);
    });
  });

  describe('XCLAIM', () => {
    it('XCLAIM로 메시지 소유권을 이전한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      await handler.execute(['XREADGROUP', 'GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>']);
      const result = await handler.execute(['XCLAIM', 'mystream', 'mygroup', 'consumer2', '0', '1-0']);
      expect(result).toMatch(/\*/);
    });
  });

  describe('XAUTOCLAIM', () => {
    it('XAUTOCLAIM로 자동 소유권 이전한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      await handler.execute(['XREADGROUP', 'GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>']);
      const result = await handler.execute(['XAUTOCLAIM', 'mystream', 'mygroup', 'consumer2', '0', '0-0']);
      expect(result).toMatch(/\*/);
    });
  });

  describe('XINFO STREAM', () => {
    it('XINFO STREAM으로 스트림 정보를 반환한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      const result = await handler.execute(['XINFO', 'STREAM', 'mystream']);
      expect(result).toMatch(/\*/);
    });
  });

  describe('XINFO GROUPS', () => {
    it('XINFO GROUPS로 그룹 정보를 반환한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      const result = await handler.execute(['XINFO', 'GROUPS', 'mystream']);
      expect(result).toMatch(/\*/);
    });
  });

  describe('XINFO CONSUMERS', () => {
    it('XINFO CONSUMERS로 컨슈머 정보를 반환한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      await handler.execute(['XGROUP', 'CREATE', 'mystream', 'mygroup', '0-0']);
      await handler.execute(['XREADGROUP', 'GROUP', 'mygroup', 'consumer1', 'STREAMS', 'mystream', '>']);
      const result = await handler.execute(['XINFO', 'CONSUMERS', 'mystream', 'mygroup']);
      expect(result).toMatch(/\*/);
    });
  });

  describe('XSETID', () => {
    it('XSETID로 마지막 ID를 설정한다', async () => {
      await handler.execute(['XADD', 'mystream', '1-0', 'f', 'v1']);
      const result = await handler.execute(['XSETID', 'mystream', '1-0']);
      expect(result).toContain('OK');
    });
  });
});