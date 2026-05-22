import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';

// ========================================
// InMemoryStorage Hash Tests
// ========================================

describe('Hash 명령 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage);
  });

  describe('HSET / HGET', () => {
    it('HSET으로 필드를 설정하고 HGET으로 값을 가져온다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HGET', 'myhash', 'f1']);
      expect(result).toBe('$2\r\nv1\r\n');
    });

    it('HSET으로 여러 필드를 동시에 설정하고 새 필드 수를 반환한다', async () => {
      const result = await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2', 'f3', 'v3']);
      expect(result).toBe(':3\r\n');
    });

    it('HSET이 기존 필드를 덮어쓰면 새 필드 수는 0을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HSET', 'myhash', 'f1', 'v2']);
      expect(result).toBe(':0\r\n');
    });

    it('HSET에서 일부는 새 필드, 일부는 업데이트인 경우 새 필드 수만 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HSET', 'myhash', 'f1', 'v2', 'f2', 'v2']);
      expect(result).toBe(':1\r\n');
    });

    it('존재하지 않는 필드에 HGET하면 null을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HGET', 'myhash', 'nonexistent']);
      expect(result).toBe('$-1\r\n');
    });

    it('존재하지 않는 키에 HGET하면 null을 반환한다', async () => {
      const result = await handler.execute(['HGET', 'nokey', 'f1']);
      expect(result).toBe('$-1\r\n');
    });

    it('HSET 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['HSET', 'myhash', 'f1']);
      expect(result).toContain('ERR');
    });

    it('HSET 필드-값 쌍이 홀수면 에러를 반환한다', async () => {
      const result = await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2']);
      expect(result).toContain('ERR');
    });

    it('HGET 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['HGET', 'myhash']);
      expect(result).toContain('ERR');
    });
  });

  describe('HDEL', () => {
    it('필드를 삭제하고 삭제된 수를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HDEL', 'myhash', 'f1']);
      expect(result).toBe(':1\r\n');
    });

    it('여러 필드를 동시에 삭제한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2', 'f3', 'v3']);
      const result = await handler.execute(['HDEL', 'myhash', 'f1', 'f2']);
      expect(result).toBe(':2\r\n');
    });

    it('존재하지 않는 필드 삭제 시 0을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HDEL', 'myhash', 'nonexistent']);
      expect(result).toBe(':0\r\n');
    });

    it('모든 필드가 삭제되면 키도 사라진다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      await handler.execute(['HDEL', 'myhash', 'f1']);
      const typeResult = await handler.execute(['TYPE', 'myhash']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('HDEL 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['HDEL', 'myhash']);
      expect(result).toContain('ERR');
    });
  });

  describe('HGETALL', () => {
    it('모든 필드-값 쌍을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HGETALL', 'myhash']);
      expect(result).toContain('f1');
      expect(result).toContain('v1');
      expect(result).toContain('f2');
      expect(result).toContain('v2');
    });

    it('빈 해시는 빈 배열을 반환한다', async () => {
      const result = await handler.execute(['HGETALL', 'nokey']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('HKEYS / HVALS / HLEN', () => {
    it('HKEYS가 모든 필드 이름을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HKEYS', 'myhash']);
      expect(result).toContain('f1');
      expect(result).toContain('f2');
    });

    it('HVALS가 모든 값을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HVALS', 'myhash']);
      expect(result).toContain('v1');
      expect(result).toContain('v2');
    });

    it('HLEN이 필드 수를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2', 'f3', 'v3']);
      const result = await handler.execute(['HLEN', 'myhash']);
      expect(result).toBe(':3\r\n');
    });

    it('존재하지 않는 키의 HLEN은 0을 반환한다', async () => {
      const result = await handler.execute(['HLEN', 'nokey']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('HEXISTS', () => {
    it('필드가 존재하면 1을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HEXISTS', 'myhash', 'f1']);
      expect(result).toBe(':1\r\n');
    });

    it('필드가 존재하지 않으면 0을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HEXISTS', 'myhash', 'nonexistent']);
      expect(result).toBe(':0\r\n');
    });

    it('키가 존재하지 않으면 0을 반환한다', async () => {
      const result = await handler.execute(['HEXISTS', 'nokey', 'f1']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('HSETNX', () => {
    it('필드가 없으면 설정하고 1을 반환한다', async () => {
      const result = await handler.execute(['HSETNX', 'myhash', 'f1', 'v1']);
      expect(result).toBe(':1\r\n');
    });

    it('필드가 이미 있으면 설정하지 않고 0을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HSETNX', 'myhash', 'f1', 'v2']);
      expect(result).toBe(':0\r\n');
    });

    it('HSETNX 후 값이 변경되지 않았는지 확인한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      await handler.execute(['HSETNX', 'myhash', 'f1', 'v2']);
      const result = await handler.execute(['HGET', 'myhash', 'f1']);
      expect(result).toBe('$2\r\nv1\r\n');
    });
  });

  describe('HMSET / HMGET', () => {
    it('HMSET으로 여러 필드를 설정한다', async () => {
      const result = await handler.execute(['HMSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      expect(result).toBe('+OK\r\n');
    });

    it('HMGET으로 여러 필드 값을 가져온다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HMGET', 'myhash', 'f1', 'f2', 'f3']);
      expect(result).toContain('v1');
      expect(result).toContain('v2');
    });

    it('HMGET에서 존재하지 않는 필드는 null을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HMGET', 'myhash', 'f1', 'nonexistent']);
      expect(result).toContain('v1');
      expect(result).toContain('$-1\r\n');
    });
  });

  describe('HINCRBY / HINCRBYFLOAT', () => {
    it('HINCRBY로 정수 값을 증가시킨다', async () => {
      await handler.execute(['HSET', 'myhash', 'counter', '10']);
      const result = await handler.execute(['HINCRBY', 'myhash', 'counter', '5']);
      expect(result).toBe(':15\r\n');
    });

    it('HINCRBY 음수로 감소시킨다', async () => {
      await handler.execute(['HSET', 'myhash', 'counter', '10']);
      const result = await handler.execute(['HINCRBY', 'myhash', 'counter', '-3']);
      expect(result).toBe(':7\r\n');
    });

    it('HINCRBY 존재하지 않는 필드는 0에서 시작한다', async () => {
      const result = await handler.execute(['HINCRBY', 'myhash', 'counter', '5']);
      expect(result).toBe(':5\r\n');
    });

    it('HINCRBY 정수가 아닌 값이면 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'counter', 'notanumber']);
      const result = await handler.execute(['HINCRBY', 'myhash', 'counter', '1']);
      expect(result).toContain('ERR');
    });

    it('HINCRBYFLOAT로 부동소수점 값을 증가시킨다', async () => {
      await handler.execute(['HSET', 'myhash', 'price', '10.5']);
      const result = await handler.execute(['HINCRBYFLOAT', 'myhash', 'price', '0.1']);
      expect(result).toContain('10.6');
    });

    it('HINCRBYFLOAT 존재하지 않는 필드는 0에서 시작한다', async () => {
      const result = await handler.execute(['HINCRBYFLOAT', 'myhash', 'price', '3.14']);
      expect(result).toContain('3.14');
    });
  });

  describe('HRANDFIELD', () => {
    it('인자 없으면 랜덤 필드 하나를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2', 'f3', 'v3']);
      const result = await handler.execute(['HRANDFIELD', 'myhash']);
      // Should be a bulk string (single field name)
      expect(result).toMatch(/^\$\d+\r\n/);
    });

    it('양수 count로 고유 필드를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2', 'f3', 'v3']);
      const result = await handler.execute(['HRANDFIELD', 'myhash', '2']);
      expect(result).toMatch(/\*2\r\n/);
    });
  });

  describe('HSTRLEN', () => {
    it('필드 값의 길이를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'hello']);
      const result = await handler.execute(['HSTRLEN', 'myhash', 'f1']);
      expect(result).toBe(':5\r\n');
    });

    it('존재하지 않는 필드는 0을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HSTRLEN', 'myhash', 'nonexistent']);
      expect(result).toBe(':0\r\n');
    });

    it('존재하지 않는 키는 0을 반환한다', async () => {
      const result = await handler.execute(['HSTRLEN', 'nokey', 'f1']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('WRONGTYPE 에러', () => {
    it('문자열 키에 HGET을 호출하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['HGET', 'mykey', 'f1']);
      expect(result).toContain('WRONGTYPE');
    });

    it('문자열 키에 HSET을 호출하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['HSET', 'mykey', 'f1', 'v1']);
      expect(result).toContain('WRONGTYPE');
    });

    it('문자열 키에 HGETALL을 호출하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['HGETALL', 'mykey']);
      expect(result).toContain('WRONGTYPE');
    });

    it('문자열 키에 HDEL을 호출하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['HDEL', 'mykey', 'f1']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('HGETDEL', () => {
    it('필드 값을 반환하고 삭제한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HGETDEL', 'myhash', 'f1']);
      expect(result).toContain('v1');
      // f1 should be deleted
      const getResult = await handler.execute(['HGET', 'myhash', 'f1']);
      expect(getResult).toBe('$-1\r\n');
    });
  });

  describe('HSETEX', () => {
    it('HSETEX로 필드를 EX 옵션과 함께 설정한다', async () => {
      const result = await handler.execute(['HSETEX', 'myhash', 'EX', '100', 'f1', 'v1']);
      expect(result).toBe(':1\r\n');
      const getResult = await handler.execute(['HGET', 'myhash', 'f1']);
      expect(getResult).toBe('$2\r\nv1\r\n');
    });

    it('HSETEX 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['HSETEX', 'myhash']);
      expect(result).toContain('ERR');
    });
  });

  describe('HSCAN', () => {
    it('HSCAN으로 해시 필드를 순회한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HSCAN', 'myhash', '0']);
      // Should contain cursor and items
      expect(result).toContain('0');
    });

    it('HSCAN MATCH로 패턴 필터링한다', async () => {
      await handler.execute(['HSET', 'myhash', 'field1', 'v1', 'field2', 'v2', 'other', 'v3']);
      const result = await handler.execute(['HSCAN', 'myhash', '0', 'MATCH', 'field*']);
      expect(result).toContain('field1');
      expect(result).toContain('field2');
    });
  });

  describe('Hash 필드 만료 (HEXPIRE / HTTL)', () => {
    it('HEXPIRE로 필드에 만료 시간을 설정한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HEXPIRE', 'myhash', '100', 'FIELDS', 'f1', 'f2']);
      // Returns array of results: 1=timeout set, 2=key doesn't exist, 0=field doesn't exist
      expect(result).toContain(':1');
    });

    it('HTTL로 남은 만료 시간을 조회한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      await handler.execute(['HEXPIRE', 'myhash', '100', 'FIELDS', 'f1']);
      const result = await handler.execute(['HTTL', 'myhash', 'FIELDS', 'f1']);
      expect(result).toContain(':');
    });

    it('만료되지 않은 필드의 HTTL은 -1을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HTTL', 'myhash', 'FIELDS', 'f1']);
      expect(result).toContain('-1');
    });

    it('존재하지 않는 키의 HEXPIRE는 2를 반환한다', async () => {
      const result = await handler.execute(['HEXPIRE', 'nokey', '100', 'FIELDS', 'f1']);
      expect(result).toContain(':2');
    });
  });

  describe('HPERSIST', () => {
    it('필드 만료를 제거한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      await handler.execute(['HEXPIRE', 'myhash', '100', 'FIELDS', 'f1']);
      const result = await handler.execute(['HPERSIST', 'myhash', 'FIELDS', 'f1']);
      expect(result).toContain(':1');
    });

    it('만료가 없는 필드의 HPERSIST는 0을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HPERSIST', 'myhash', 'FIELDS', 'f1']);
      expect(result).toContain(':0');
    });
  });
});

// ========================================
// SqliteStorage Hash Tests
// ========================================

describe('Hash 명령 — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage);
  });

  describe('HSET / HGET', () => {
    it('HSET으로 필드를 설정하고 HGET으로 값을 가져온다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HGET', 'myhash', 'f1']);
      expect(result).toBe('$2\r\nv1\r\n');
    });

    it('HSET으로 여러 필드를 동시에 설정한다', async () => {
      const result = await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      expect(result).toBe(':2\r\n');
    });

    it('HGET이 존재하지 않는 필드에 null을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HGET', 'myhash', 'nope']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('HDEL', () => {
    it('필드를 삭제하고 수를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HDEL', 'myhash', 'f1']);
      expect(result).toBe(':1\r\n');
    });
  });

  describe('HLEN', () => {
    it('필드 수를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2', 'f3', 'v3']);
      const result = await handler.execute(['HLEN', 'myhash']);
      expect(result).toBe(':3\r\n');
    });
  });

  describe('HEXISTS', () => {
    it('존재하는 필드에 1을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HEXISTS', 'myhash', 'f1']);
      expect(result).toBe(':1\r\n');
    });

    it('존재하지 않는 필드에 0을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['HEXISTS', 'myhash', 'nope']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('HINCRBY', () => {
    it('정수 값을 증가시킨다', async () => {
      await handler.execute(['HSET', 'myhash', 'counter', '10']);
      const result = await handler.execute(['HINCRBY', 'myhash', 'counter', '5']);
      expect(result).toBe(':15\r\n');
    });
  });

  describe('HGETALL', () => {
    it('모든 필드-값을 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1', 'f2', 'v2']);
      const result = await handler.execute(['HGETALL', 'myhash']);
      expect(result).toContain('f1');
      expect(result).toContain('v1');
    });
  });

  describe('WRONGTYPE', () => {
    it('문자열 키에 해시 명령을 사용하면 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['HGET', 'mykey', 'f1']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('TYPE 명령으로 hash 타입 확인', () => {
    it('HSET 후 TYPE이 hash를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['TYPE', 'myhash']);
      expect(result).toBe('+hash\r\n');
    });
  });
});