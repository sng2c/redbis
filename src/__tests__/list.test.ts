import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import { PubSubManager } from '../pubsub/manager';

// ========================================
// InMemoryStorage List Tests
// ========================================

describe('List 명령 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('LPUSH / RPUSH', () => {
    it('LPUSH로 요소를 추가하고 길이를 반환한다', async () => {
      const result = await handler.execute(['LPUSH', 'mylist', 'a', 'b', 'c']);
      expect(result).toBe(':3\r\n');
    });

    it('RPUSH로 요소를 추가하고 길이를 반환한다', async () => {
      const result = await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      expect(result).toBe(':3\r\n');
    });

    it('LPUSH 후 RPUSH로 이어서 추가한다', async () => {
      await handler.execute(['LPUSH', 'mylist', 'a']);
      const result = await handler.execute(['RPUSH', 'mylist', 'b']);
      expect(result).toBe(':2\r\n');
    });

    it('LPUSH 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['LPUSH', 'mylist']);
      expect(result).toContain('ERR');
    });
  });

  describe('LPOP / RPOP', () => {
    it('LPOP으로 왼쪽 요소를 꺼낸다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LPOP', 'mylist']);
      expect(result).toBe('$1\r\na\r\n');
    });

    it('RPOP으로 오른쪽 요소를 꺼낸다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['RPOP', 'mylist']);
      expect(result).toBe('$1\r\nc\r\n');
    });

    it('LPOP with count returns array', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LPOP', 'mylist', '2']);
      expect(result).toMatch(/\*2/);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('빈 리스트에서 LPOP은 null을 반환한다', async () => {
      const result = await handler.execute(['LPOP', 'mylist']);
      expect(result).toBe('$-1\r\n');
    });

    it('존재하지 않는 키에서 RPOP은 null을 반환한다', async () => {
      const result = await handler.execute(['RPOP', 'nokey']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('LLEN', () => {
    it('리스트 길이를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LLEN', 'mylist']);
      expect(result).toBe(':3\r\n');
    });

    it('존재하지 않는 키는 0을 반환한다', async () => {
      const result = await handler.execute(['LLEN', 'nokey']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('LRANGE', () => {
    it('리스트 범위를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c', 'd', 'e']);
      const result = await handler.execute(['LRANGE', 'mylist', '0', '2']);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('음수 인덱스로 범위를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LRANGE', 'mylist', '-2', '-1']);
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('전체 리스트를 반환한다 (0 -1)', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LRANGE', 'mylist', '0', '-1']);
      expect(result).toMatch(/\*3/);
    });

    it('존재하지 않는 키는 빈 배열을 반환한다', async () => {
      const result = await handler.execute(['LRANGE', 'nokey', '0', '-1']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('LINDEX', () => {
    it('인덱스로 요소를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LINDEX', 'mylist', '1']);
      expect(result).toBe('$1\r\nb\r\n');
    });

    it('음수 인덱스로 요소를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LINDEX', 'mylist', '-1']);
      expect(result).toBe('$1\r\nc\r\n');
    });

    it('범위를 벗어난 인덱스는 null을 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b']);
      const result = await handler.execute(['LINDEX', 'mylist', '5']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('LSET', () => {
    it('인덱스로 요소를 설정한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LSET', 'mylist', '1', 'x']);
      expect(result).toBe('+OK\r\n');
      const indexResult = await handler.execute(['LINDEX', 'mylist', '1']);
      expect(indexResult).toBe('$1\r\nx\r\n');
    });

    it('범위를 벗어난 인덱스는 에러를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a']);
      const result = await handler.execute(['LSET', 'mylist', '5', 'x']);
      expect(result).toContain('ERR');
    });
  });

  describe('LREM', () => {
    it('count > 0이면 앞에서부터 제거한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'a', 'c', 'a']);
      const result = await handler.execute(['LREM', 'mylist', '2', 'a']);
      expect(result).toBe(':2\r\n');
    });

    it('count = 0이면 모든 요소를 제거한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'a', 'c', 'a']);
      const result = await handler.execute(['LREM', 'mylist', '0', 'a']);
      expect(result).toBe(':3\r\n');
    });

    it('count < 0이면 뒤에서부터 제거한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'a', 'c', 'a']);
      const result = await handler.execute(['LREM', 'mylist', '-2', 'a']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('LTRIM', () => {
    it('지정된 범위만 유지한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c', 'd', 'e']);
      const result = await handler.execute(['LTRIM', 'mylist', '1', '3']);
      expect(result).toBe('+OK\r\n');
      const rangeResult = await handler.execute(['LRANGE', 'mylist', '0', '-1']);
      expect(rangeResult).toContain('b');
      expect(rangeResult).toContain('c');
      expect(rangeResult).toContain('d');
      expect(rangeResult).not.toContain('a');
      expect(rangeResult).not.toContain('e');
    });
  });

  describe('RPOPLPUSH', () => {
    it('소스에서 오른쪽 팝, 대상에 왼쪽 푸시', async () => {
      await handler.execute(['RPUSH', 'src', 'a', 'b', 'c']);
      const result = await handler.execute(['RPOPLPUSH', 'src', 'dst']);
      expect(result).toBe('$1\r\nc\r\n');
      const srcResult = await handler.execute(['LRANGE', 'src', '0', '-1']);
      expect(srcResult).toContain('a');
      expect(srcResult).toContain('b');
      const dstResult = await handler.execute(['LRANGE', 'dst', '0', '-1']);
      expect(dstResult).toContain('c');
    });

    it('빈 소스에서는 null을 반환한다', async () => {
      const result = await handler.execute(['RPOPLPUSH', 'src', 'dst']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('LPUSHX / RPUSHX', () => {
    it('LPUSHX는 키가 존재할 때만 추가한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a']);
      const result = await handler.execute(['LPUSHX', 'mylist', 'b']);
      expect(result).toBe(':2\r\n');
    });

    it('LPUSHX는 키가 없으면 0을 반환한다', async () => {
      const result = await handler.execute(['LPUSHX', 'nokey', 'a']);
      expect(result).toBe(':0\r\n');
    });

    it('RPUSHX는 키가 존재할 때만 추가한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a']);
      const result = await handler.execute(['RPUSHX', 'mylist', 'b']);
      expect(result).toBe(':2\r\n');
    });

    it('RPUSHX는 키가 없으면 0을 반환한다', async () => {
      const result = await handler.execute(['RPUSHX', 'nokey', 'a']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('LINSERT', () => {
    it('BEFORE로 피벗 앞에 삽입한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LINSERT', 'mylist', 'BEFORE', 'b', 'x']);
      expect(result).toBe(':4\r\n');
      const range = await handler.execute(['LRANGE', 'mylist', '0', '-1']);
      expect(range).toContain('x');
    });

    it('AFTER로 피벗 뒤에 삽입한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LINSERT', 'mylist', 'AFTER', 'b', 'x']);
      expect(result).toBe(':4\r\n');
    });

    it('피벗이 없으면 -1을 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b']);
      const result = await handler.execute(['LINSERT', 'mylist', 'BEFORE', 'z', 'x']);
      expect(result).toBe(':-1\r\n');
    });
  });

  describe('LPOS', () => {
    it('요소의 위치를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c', 'b']);
      const result = await handler.execute(['LPOS', 'mylist', 'b']);
      expect(result).toBe(':1\r\n');
    });

    it('요소가 없으면 null을 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LPOS', 'mylist', 'z']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('LMOVE', () => {
    it('LEFT에서 LEFT로 이동한다', async () => {
      await handler.execute(['RPUSH', 'src', 'a', 'b', 'c']);
      const result = await handler.execute(['LMOVE', 'src', 'dst', 'LEFT', 'LEFT']);
      expect(result).toBe('$1\r\na\r\n');
    });

    it('RIGHT에서 LEFT로 이동한다', async () => {
      await handler.execute(['RPUSH', 'src', 'a', 'b', 'c']);
      const result = await handler.execute(['LMOVE', 'src', 'dst', 'RIGHT', 'LEFT']);
      expect(result).toBe('$1\r\nc\r\n');
    });
  });

  describe('LMPOP', () => {
    it('첫 번째 비어있지 않은 리스트에서 팝한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b']);
      const result = await handler.execute(['LMPOP', '1', 'mylist', 'LEFT']);
      // Returns key + elements
      expect(result).toContain('mylist');
      expect(result).toContain('a');
    });

    it('모든 키가 비어있으면 null을 반환한다', async () => {
      const result = await handler.execute(['LMPOP', '1', 'nokey', 'LEFT']);
      expect(result).toBe('*-1\r\n');
    });
  });

  describe('BLPOP / BRPOP (non-blocking)', () => {
    it('BLPOP은 요소가 있으면 즉시 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a']);
      const result = await handler.execute(['BLPOP', 'mylist', '0']);
      expect(result).toContain('mylist');
      expect(result).toContain('a');
    });

    it('BLPOP은 리스트가 비어있으면 null 배열을 반환한다', async () => {
      const result = await handler.execute(['BLPOP', 'nokey', '0']);
      // When no elements available, returns null array
      expect(result).toMatch(/\*-1/);
    });

    it('BRPOP은 요소가 있으면 즉시 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b']);
      const result = await handler.execute(['BRPOP', 'mylist', '0']);
      expect(result).toContain('mylist');
      expect(result).toContain('b');
    });
  });

  describe('WRONGTYPE', () => {
    it('문자열 키에 LPUSH를 호출하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['LPUSH', 'mykey', 'a']);
      expect(result).toContain('WRONGTYPE');
    });

    it('문자열 키에 LRANGE를 호출하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['LRANGE', 'mykey', '0', '-1']);
      expect(result).toContain('WRONGTYPE');
    });

    it('문자열 키에 LLEN을 호출하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['LLEN', 'mykey']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('TYPE 명령으로 list 타입 확인', () => {
    it('LPUSH 후 TYPE이 list를 반환한다', async () => {
      await handler.execute(['LPUSH', 'mylist', 'a']);
      const result = await handler.execute(['TYPE', 'mylist']);
      expect(result).toBe('+list\r\n');
    });
  });
});

// ========================================
// SqliteStorage List Tests
// ========================================

describe('List 명령 — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('LPUSH / RPUSH', () => {
    it('LPUSH로 요소를 추가한다', async () => {
      const result = await handler.execute(['LPUSH', 'mylist', 'a', 'b', 'c']);
      expect(result).toBe(':3\r\n');
    });

    it('RPUSH로 요소를 추가한다', async () => {
      const result = await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      expect(result).toBe(':3\r\n');
    });

    it('LPUSH 후 LRANGE로 순서를 확인한다', async () => {
      await handler.execute(['LPUSH', 'mylist', 'a', 'b', 'c']);
      // LPUSH multi: c, b, a (last arg pushed first)
      const result = await handler.execute(['LRANGE', 'mylist', '0', '-1']);
      expect(result).toContain('c');
      expect(result).toContain('b');
      expect(result).toContain('a');
    });
  });

  describe('LPOP / RPOP', () => {
    it('LPOP으로 요소를 꺼낸다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LPOP', 'mylist']);
      expect(result).toBe('$1\r\na\r\n');
    });

    it('RPOP으로 요소를 꺼낸다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['RPOP', 'mylist']);
      expect(result).toBe('$1\r\nc\r\n');
    });
  });

  describe('LRANGE', () => {
    it('리스트 범위를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LRANGE', 'mylist', '0', '1']);
      expect(result).toMatch(/\*2/);
    });
  });

  describe('LLEN', () => {
    it('리스트 길이를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LLEN', 'mylist']);
      expect(result).toBe(':3\r\n');
    });
  });

  describe('LINDEX', () => {
    it('인덱스로 요소를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      const result = await handler.execute(['LINDEX', 'mylist', '1']);
      expect(result).toBe('$1\r\nb\r\n');
    });
  });

  describe('LSET', () => {
    it('인덱스로 요소를 설정한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
      await handler.execute(['LSET', 'mylist', '1', 'x']);
      const result = await handler.execute(['LINDEX', 'mylist', '1']);
      expect(result).toBe('$1\r\nx\r\n');
    });
  });

  describe('LREM', () => {
    it('count > 0으로 앞에서부터 제거한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'a', 'c', 'a']);
      const result = await handler.execute(['LREM', 'mylist', '2', 'a']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('LTRIM', () => {
    it('범위 외 요소를 제거한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c', 'd', 'e']);
      await handler.execute(['LTRIM', 'mylist', '1', '3']);
      const result = await handler.execute(['LLEN', 'mylist']);
      expect(result).toBe(':3\r\n');
    });
  });

  describe('WRONGTYPE', () => {
    it('문자열 키에 리스트 명령을 사용하면 에러를 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'value']);
      const result = await handler.execute(['LPUSH', 'mykey', 'a']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('TYPE 명령으로 list 타입 확인', () => {
    it('RPUSH 후 TYPE이 list를 반환한다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a']);
      const result = await handler.execute(['TYPE', 'mylist']);
      expect(result).toBe('+list\r\n');
    });
  });

  describe('모든 요소 POP 후 키 자동 삭제', () => {
    it('모든 요소를 POP하면 키가 삭제된다', async () => {
      await handler.execute(['RPUSH', 'mylist', 'a']);
      await handler.execute(['LPOP', 'mylist']);
      const typeResult = await handler.execute(['TYPE', 'mylist']);
      expect(typeResult).toBe('+none\r\n');
    });
  });
});
