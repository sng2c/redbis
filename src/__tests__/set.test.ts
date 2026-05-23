import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import { PubSubManager } from '../pubsub/manager';

// ========================================
// InMemoryStorage Set Tests
// ========================================

describe('세트(Set) 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('세트 멤버 추가 및 조회 (SADD / SREM / SMEMBERS / SCARD)', () => {
    it('SADD로 멤버를 추가하고 SMEMBERS로 모든 멤버를 조회한다', async () => {
      const addResult = await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      expect(addResult).toBe(':3\r\n');

      const members = await handler.execute(['SMEMBERS', 'myset']);
      expect(members).toContain('a');
      expect(members).toContain('b');
      expect(members).toContain('c');
      expect(members).toMatch(/^\*3\r\n/);
    });

    it('SCARD로 멤버 수를 확인한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SCARD', 'myset']);
      expect(result).toBe(':3\r\n');
    });

    it('중복 멤버 추가 시 새로 추가된 수만 반환하고 scard는 변하지 않는다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const result = await handler.execute(['SADD', 'myset', 'a', 'c']);
      expect(result).toBe(':1\r\n');

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':3\r\n');
    });

    it('SREM으로 멤버를 삭제하고 삭제된 수를 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SREM', 'myset', 'a', 'b']);
      expect(result).toBe(':2\r\n');

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':1\r\n');
    });

    it('존재하지 않는 멤버 삭제 시 0을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a']);
      const result = await handler.execute(['SREM', 'myset', 'z']);
      expect(result).toBe(':0\r\n');
    });

    it('빈 세트 정리 — 모든 멤버 삭제 시 키가 사라진다', async () => {
      await handler.execute(['SADD', 'myset', 'a']);
      await handler.execute(['SREM', 'myset', 'a']);
      const typeResult = await handler.execute(['TYPE', 'myset']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('SADD 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SADD', 'myset']);
      expect(result).toContain('ERR');
    });

    it('SREM 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SREM', 'myset']);
      expect(result).toContain('ERR');
    });

    it('SMEMBERS 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SMEMBERS']);
      expect(result).toContain('ERR');
    });

    it('SCARD 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SCARD']);
      expect(result).toContain('ERR');
    });

    it('존재하지 않는 키에 SMEMBERS하면 빈 배열을 반환한다', async () => {
      const result = await handler.execute(['SMEMBERS', 'noset']);
      expect(result).toBe('*0\r\n');
    });

    it('존재하지 않는 키에 SCARD하면 0을 반환한다', async () => {
      const result = await handler.execute(['SCARD', 'noset']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('멤버 존재 확인 (SISMEMBER / SMISMEMBER)', () => {
    it('SISMEMBER로 멤버 존재 확인 — 존재하면 1, 없으면 0', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const yes = await handler.execute(['SISMEMBER', 'myset', 'a']);
      expect(yes).toBe(':1\r\n');
      const no = await handler.execute(['SISMEMBER', 'myset', 'z']);
      expect(no).toBe(':0\r\n');
    });

    it('SMISMEMBER로 다중 멤버 존재 확인 — 배열로 반환된다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const result = await handler.execute(['SMISMEMBER', 'myset', 'a', 'z', 'b']);
      expect(result).toContain(':1\r\n');
      expect(result).toContain(':0\r\n');
      expect(result).toMatch(/^\*3\r\n/);
    });

    it('SISMEMBER 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SISMEMBER', 'myset']);
      expect(result).toContain('ERR');
    });

    it('SMISMEMBER 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SMISMEMBER', 'myset']);
      expect(result).toContain('ERR');
    });

    it('존재하지 않는 키에 SISMEMBER하면 0을 반환한다', async () => {
      const result = await handler.execute(['SISMEMBER', 'noset', 'a']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('랜덤 멤버 조회 (SRANDMEMBER)', () => {
    it('양수 카운트로 고유 멤버를 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SRANDMEMBER', 'myset', '2']);
      // Should be a RESP array with 2 elements
      expect(result).toMatch(/^\*2\r\n/);
    });

    it('카운트 없이 단일 멤버를 bulk string으로 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SRANDMEMBER', 'myset']);
      // Should be a single bulk string, not an array
      expect(result).toMatch(/^\$[0-9]+\r\n/);
      expect(result).not.toMatch(/^\*/);
    });

    it('음수 카운트 랜덤 멤버 — 중복을 허용한다', async () => {
      await handler.execute(['SADD', 'myset', 'a']);
      const result = await handler.execute(['SRANDMEMBER', 'myset', '-5']);
      // Should return array of 5 elements (with duplicates allowed)
      expect(result).toMatch(/^\*5\r\n/);
    });

    it('존재하지 않는 키에 SRANDMEMBER count 없이 호출하면 nil을 반환한다', async () => {
      const result = await handler.execute(['SRANDMEMBER', 'noset']);
      expect(result).toBe('$-1\r\n');
    });

    it('존재하지 않는 키에 SRANDMEMBER count와 함께 호출하면 빈 배열을 반환한다', async () => {
      const result = await handler.execute(['SRANDMEMBER', 'noset', '3']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('랜덤 멤버 제거 (SPOP)', () => {
    it('SPOP으로 멤버를 제거하고 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SPOP', 'myset']);
      // Single bulk string (no count)
      expect(result).toMatch(/^\$[0-9]+\r\n/);

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':2\r\n');
    });

    it('카운트와 함께 SPOP하면 배열을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c', 'd']);
      const result = await handler.execute(['SPOP', 'myset', '2']);
      expect(result).toMatch(/^\*2\r\n/);

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':2\r\n');
    });

    it('SPOP count=1이면 단일 bulk string을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const result = await handler.execute(['SPOP', 'myset', '1']);
      expect(result).toMatch(/^\$[0-9]+\r\n/);
      expect(result).not.toMatch(/^\*/);
    });

    it('빈 세트 팝 — 존재하지 않는 키면 nil을 반환한다', async () => {
      const result = await handler.execute(['SPOP', 'noset']);
      expect(result).toBe('$-1\r\n');
    });

    it('빈 세트 팝 count와 함께 — 빈 배열 반환', async () => {
      const result = await handler.execute(['SPOP', 'noset', '3']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('멤버 이동 (SMOVE)', () => {
    it('멤버를 소스에서 대상으로 이동한다', async () => {
      await handler.execute(['SADD', 'src', 'a', 'b']);
      const result = await handler.execute(['SMOVE', 'src', 'dst', 'a']);
      expect(result).toBe(':1\r\n');

      const srcMembers = await handler.execute(['SMEMBERS', 'src']);
      expect(srcMembers).toContain('b');
      expect(srcMembers).not.toContain('a');

      const dstMembers = await handler.execute(['SMEMBERS', 'dst']);
      expect(dstMembers).toContain('a');
    });

    it('존재하지 않는 멤버 이동 시 0을 반환한다', async () => {
      await handler.execute(['SADD', 'src', 'a']);
      const result = await handler.execute(['SMOVE', 'src', 'dst', 'z']);
      expect(result).toBe(':0\r\n');
    });

    it('같은 키 간 이동 (source === destination) 시 1을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const result = await handler.execute(['SMOVE', 'myset', 'myset', 'a']);
      expect(result).toBe(':1\r\n');

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':2\r\n');
    });

    it('SMOVE 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SMOVE', 'src', 'dst']);
      expect(result).toContain('ERR');
    });

    it('존재하지 않는 소스 키에 SMOVE하면 0을 반환한다', async () => {
      const result = await handler.execute(['SMOVE', 'nosrc', 'dst', 'a']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('세트 차집합 (SDIFF)', () => {
    it('SDIFF로 첫 번째 키에서 나머지 키에 없는 멤버를 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c']);
      const result = await handler.execute(['SDIFF', 's1', 's2']);
      expect(result).toContain('a');
      expect(result).not.toContain('b');
      expect(result).not.toContain('c');
    });

    it('존재하지 않는 키는 빈 세트로 취급한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b']);
      const result = await handler.execute(['SDIFF', 's1', 'noset']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('SDIFF 인자가 없으면 에러를 반환한다', async () => {
      const result = await handler.execute(['SDIFF']);
      expect(result).toContain('ERR');
    });
  });

  describe('세트 교집합 (SINTER)', () => {
    it('SINTER로 모든 키에 공통으로 있는 멤버를 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c', 'd']);
      const result = await handler.execute(['SINTER', 's1', 's2']);
      expect(result).toContain('b');
      expect(result).toContain('c');
      expect(result).not.toContain('a');
      expect(result).not.toContain('d');
    });

    it('교집합이 없으면 빈 배열을 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      await handler.execute(['SADD', 's2', 'b']);
      const result = await handler.execute(['SINTER', 's1', 's2']);
      expect(result).toBe('*0\r\n');
    });

    it('존재하지 않는 키는 빈 세트로 취급하여 교집합도 빈 배열', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      const result = await handler.execute(['SINTER', 's1', 'noset']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('세트 합집합 (SUNION)', () => {
    it('SUNION로 모든 키의 멤버 합집합을 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b']);
      await handler.execute(['SADD', 's2', 'b', 'c']);
      const result = await handler.execute(['SUNION', 's1', 's2']);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
      expect(result).toMatch(/^\*3\r\n/);
    });

    it('존재하지 않는 키는 빈 세트로 취급한다', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      const result = await handler.execute(['SUNION', 's1', 'noset']);
      expect(result).toContain('a');
    });
  });

  describe('차집합 저장 (SDIFFSTORE)', () => {
    it('SDIFFSTORE로 차집합 결과를 저장한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c']);
      const result = await handler.execute(['SDIFFSTORE', 'dest', 's1', 's2']);
      expect(result).toBe(':1\r\n');

      const destMembers = await handler.execute(['SMEMBERS', 'dest']);
      expect(destMembers).toContain('a');
    });

    it('빈 결과 저장 시 대상 키가 삭제된다', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      await handler.execute(['SADD', 's2', 'a']);
      await handler.execute(['SDIFFSTORE', 'dest', 's1', 's2']);
      const typeResult = await handler.execute(['TYPE', 'dest']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('SDIFFSTORE 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SDIFFSTORE', 'dest']);
      expect(result).toContain('ERR');
    });
  });

  describe('교집합 저장 (SINTERSTORE)', () => {
    it('SINTERSTORE로 교집합 결과를 저장한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c', 'd']);
      const result = await handler.execute(['SINTERSTORE', 'dest', 's1', 's2']);
      expect(result).toBe(':2\r\n');

      const destMembers = await handler.execute(['SMEMBERS', 'dest']);
      expect(destMembers).toContain('b');
      expect(destMembers).toContain('c');
    });

    it('빈 결과 저장 시 대상 키가 삭제된다', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      await handler.execute(['SADD', 's2', 'b']);
      await handler.execute(['SINTERSTORE', 'dest', 's1', 's2']);
      const typeResult = await handler.execute(['TYPE', 'dest']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('합집합 저장 (SUNIONSTORE)', () => {
    it('SUNIONSTORE로 합집합 결과를 저장한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b']);
      await handler.execute(['SADD', 's2', 'b', 'c']);
      const result = await handler.execute(['SUNIONSTORE', 'dest', 's1', 's2']);
      expect(result).toBe(':3\r\n');

      const destMembers = await handler.execute(['SMEMBERS', 'dest']);
      expect(destMembers).toContain('a');
      expect(destMembers).toContain('b');
      expect(destMembers).toContain('c');
    });

    it('빈 결과 저장 시 대상 키가 삭제된다', async () => {
      await handler.execute(['SUNIONSTORE', 'dest', 'noset1', 'noset2']);
      const typeResult = await handler.execute(['TYPE', 'dest']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('교집합 카디널리티 (SINTERCARD)', () => {
    it('SINTERCARD로 교집합의 멤버 수를 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c', 'd']);
      const result = await handler.execute(['SINTERCARD', '2', 's1', 's2']);
      expect(result).toBe(':2\r\n');
    });

    it('LIMIT 옵션 — limit에 도달하면 카운트를 중지한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c', 'd']);
      await handler.execute(['SADD', 's2', 'a', 'b', 'c', 'd']);
      const result = await handler.execute(['SINTERCARD', '2', 's1', 's2', 'LIMIT', '2']);
      expect(result).toBe(':2\r\n');
    });

    it('LIMIT가 교집합보다 크면 실제 교집합 크기를 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b']);
      await handler.execute(['SADD', 's2', 'a', 'b']);
      const result = await handler.execute(['SINTERCARD', '2', 's1', 's2', 'LIMIT', '10']);
      expect(result).toBe(':2\r\n');
    });

    it('SINTERCARD 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SINTERCARD']);
      expect(result).toContain('ERR');
    });
  });

  describe('세트 스캔 (SSCAN)', () => {
    it('SSCAN으로 기본 스캔 — 멤버를 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SSCAN', 'myset', '0']);
      // Should be *2\r\n[cursor][members_array]
      expect(result).toMatch(/^\*2\r\n/);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('MATCH 패턴으로 필터링한다', async () => {
      await handler.execute(['SADD', 'myset', 'apple', 'banana', 'avocado']);
      const result = await handler.execute(['SSCAN', 'myset', '0', 'MATCH', 'a*']);
      expect(result).toContain('apple');
      expect(result).toContain('avocado');
      expect(result).not.toContain('banana');
    });

    it('COUNT 옵션으로 페이지 크기를 설정한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c', 'd', 'e']);
      const result = await handler.execute(['SSCAN', 'myset', '0', 'COUNT', '3']);
      expect(result).toMatch(/^\*2\r\n/);
    });

    it('MATCH와 COUNT를 함께 사용할 수 있다', async () => {
      await handler.execute(['SADD', 'myset', 'apple', 'banana', 'avocado', 'blueberry']);
      const result = await handler.execute(['SSCAN', 'myset', '0', 'COUNT', '10', 'MATCH', 'b*']);
      expect(result).toMatch(/^\*2\r\n/);
      expect(result).toContain('banana');
      expect(result).toContain('blueberry');
    });

    it('존재하지 않는 키 스캔 — cursor 0, 빈 배열 반환', async () => {
      const result = await handler.execute(['SSCAN', 'noset', '0']);
      expect(result).toMatch(/^\*2\r\n/);
      expect(result).toContain('$1\r\n0\r\n'); // cursor = "0"
      expect(result).toContain('*0\r\n'); // empty members
    });

    it('SSCAN 인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SSCAN', 'myset']);
      expect(result).toContain('ERR');
    });
  });

  describe('WRONGTYPE 오류', () => {
    it('문자열 키에 세트 명령을 사용하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'strkey', 'value']);
      const result = await handler.execute(['SADD', 'strkey', 'member']);
      expect(result).toContain('WRONGTYPE');
    });

    it('해시 키에 세트 명령을 사용하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'hashkey', 'f1', 'v1']);
      const result = await handler.execute(['SMEMBERS', 'hashkey']);
      expect(result).toContain('WRONGTYPE');
    });

    it('리스트 키에 세트 명령을 사용하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['LPUSH', 'listkey', 'elem']);
      const result = await handler.execute(['SCARD', 'listkey']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('TYPE 명령으로 set 타입 확인', () => {
    it('SADD 후 TYPE이 set을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a']);
      const result = await handler.execute(['TYPE', 'myset']);
      expect(result).toBe('+set\r\n');
    });
  });
});

// ========================================
// SqliteStorage Set Tests
// ========================================

describe('세트(Set) 명령어 — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('세트 멤버 추가 및 조회 (SADD / SREM / SMEMBERS / SCARD)', () => {
    it('SADD로 멤버를 추가하고 SMEMBERS로 모든 멤버를 조회한다', async () => {
      const addResult = await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      expect(addResult).toBe(':3\r\n');

      const members = await handler.execute(['SMEMBERS', 'myset']);
      expect(members).toContain('a');
      expect(members).toContain('b');
      expect(members).toContain('c');
      expect(members).toMatch(/^\*3\r\n/);
    });

    it('SCARD로 멤버 수를 확인한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SCARD', 'myset']);
      expect(result).toBe(':3\r\n');
    });

    it('중복 멤버 추가 시 새로 추가된 수만 반환하고 scard는 변하지 않는다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const result = await handler.execute(['SADD', 'myset', 'a', 'c']);
      expect(result).toBe(':1\r\n');

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':3\r\n');
    });

    it('SREM으로 멤버를 삭제하고 삭제된 수를 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SREM', 'myset', 'a', 'b']);
      expect(result).toBe(':2\r\n');

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':1\r\n');
    });

    it('존재하지 않는 멤버 삭제 시 0을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a']);
      const result = await handler.execute(['SREM', 'myset', 'z']);
      expect(result).toBe(':0\r\n');
    });

    it('빈 세트 정리 — 모든 멤버 삭제 시 키가 사라진다', async () => {
      await handler.execute(['SADD', 'myset', 'a']);
      await handler.execute(['SREM', 'myset', 'a']);
      const typeResult = await handler.execute(['TYPE', 'myset']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('존재하지 않는 키에 SMEMBERS하면 빈 배열을 반환한다', async () => {
      const result = await handler.execute(['SMEMBERS', 'noset']);
      expect(result).toBe('*0\r\n');
    });

    it('존재하지 않는 키에 SCARD하면 0을 반환한다', async () => {
      const result = await handler.execute(['SCARD', 'noset']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('멤버 존재 확인 (SISMEMBER / SMISMEMBER)', () => {
    it('SISMEMBER로 멤버 존재 확인 — 존재하면 1, 없으면 0', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const yes = await handler.execute(['SISMEMBER', 'myset', 'a']);
      expect(yes).toBe(':1\r\n');
      const no = await handler.execute(['SISMEMBER', 'myset', 'z']);
      expect(no).toBe(':0\r\n');
    });

    it('SMISMEMBER로 다중 멤버 존재 확인 — 배열로 반환된다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const result = await handler.execute(['SMISMEMBER', 'myset', 'a', 'z', 'b']);
      expect(result).toContain(':1\r\n');
      expect(result).toContain(':0\r\n');
      expect(result).toMatch(/^\*3\r\n/);
    });

    it('존재하지 않는 키에 SISMEMBER하면 0을 반환한다', async () => {
      const result = await handler.execute(['SISMEMBER', 'noset', 'a']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('랜덤 멤버 조회 (SRANDMEMBER)', () => {
    it('양수 카운트로 고유 멤버를 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SRANDMEMBER', 'myset', '2']);
      expect(result).toMatch(/^\*2\r\n/);
    });

    it('카운트 없이 단일 멤버를 bulk string으로 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SRANDMEMBER', 'myset']);
      expect(result).toMatch(/^\$[0-9]+\r\n/);
      expect(result).not.toMatch(/^\*/);
    });

    it('음수 카운트 랜덤 멤버 — 중복을 허용한다', async () => {
      await handler.execute(['SADD', 'myset', 'a']);
      const result = await handler.execute(['SRANDMEMBER', 'myset', '-5']);
      expect(result).toMatch(/^\*5\r\n/);
    });

    it('존재하지 않는 키에 SRANDMEMBER count 없이 호출하면 nil을 반환한다', async () => {
      const result = await handler.execute(['SRANDMEMBER', 'noset']);
      expect(result).toBe('$-1\r\n');
    });

    it('존재하지 않는 키에 SRANDMEMBER count와 함께 호출하면 빈 배열을 반환한다', async () => {
      const result = await handler.execute(['SRANDMEMBER', 'noset', '3']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('랜덤 멤버 제거 (SPOP)', () => {
    it('SPOP으로 멤버를 제거하고 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SPOP', 'myset']);
      expect(result).toMatch(/^\$[0-9]+\r\n/);

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':2\r\n');
    });

    it('카운트와 함께 SPOP하면 배열을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c', 'd']);
      const result = await handler.execute(['SPOP', 'myset', '2']);
      expect(result).toMatch(/^\*2\r\n/);

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':2\r\n');
    });

    it('SPOP count=1이면 단일 bulk string을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const result = await handler.execute(['SPOP', 'myset', '1']);
      expect(result).toMatch(/^\$[0-9]+\r\n/);
      expect(result).not.toMatch(/^\*/);
    });

    it('빈 세트 팝 — 존재하지 않는 키면 nil을 반환한다', async () => {
      const result = await handler.execute(['SPOP', 'noset']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('멤버 이동 (SMOVE)', () => {
    it('멤버를 소스에서 대상으로 이동한다', async () => {
      await handler.execute(['SADD', 'src', 'a', 'b']);
      const result = await handler.execute(['SMOVE', 'src', 'dst', 'a']);
      expect(result).toBe(':1\r\n');

      const srcMembers = await handler.execute(['SMEMBERS', 'src']);
      expect(srcMembers).toContain('b');
      expect(srcMembers).not.toContain('a');

      const dstMembers = await handler.execute(['SMEMBERS', 'dst']);
      expect(dstMembers).toContain('a');
    });

    it('존재하지 않는 멤버 이동 시 0을 반환한다', async () => {
      await handler.execute(['SADD', 'src', 'a']);
      const result = await handler.execute(['SMOVE', 'src', 'dst', 'z']);
      expect(result).toBe(':0\r\n');
    });

    it('같은 키 간 이동 (source === destination) 시 1을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b']);
      const result = await handler.execute(['SMOVE', 'myset', 'myset', 'a']);
      expect(result).toBe(':1\r\n');

      const scard = await handler.execute(['SCARD', 'myset']);
      expect(scard).toBe(':2\r\n');
    });
  });

  describe('세트 차집합 (SDIFF)', () => {
    it('SDIFF로 첫 번째 키에서 나머지 키에 없는 멤버를 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c']);
      const result = await handler.execute(['SDIFF', 's1', 's2']);
      expect(result).toContain('a');
      expect(result).not.toContain('b');
      expect(result).not.toContain('c');
    });

    it('존재하지 않는 키는 빈 세트로 취급한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b']);
      const result = await handler.execute(['SDIFF', 's1', 'noset']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });
  });

  describe('세트 교집합 (SINTER)', () => {
    it('SINTER로 모든 키에 공통으로 있는 멤버를 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c', 'd']);
      const result = await handler.execute(['SINTER', 's1', 's2']);
      expect(result).toContain('b');
      expect(result).toContain('c');
      expect(result).not.toContain('a');
    });

    it('교집합이 없으면 빈 배열을 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      await handler.execute(['SADD', 's2', 'b']);
      const result = await handler.execute(['SINTER', 's1', 's2']);
      expect(result).toBe('*0\r\n');
    });

    it('존재하지 않는 키는 빈 세트로 취급하여 교집합도 빈 배열', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      const result = await handler.execute(['SINTER', 's1', 'noset']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('세트 합집합 (SUNION)', () => {
    it('SUNION로 모든 키의 멤버 합집합을 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b']);
      await handler.execute(['SADD', 's2', 'b', 'c']);
      const result = await handler.execute(['SUNION', 's1', 's2']);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
      expect(result).toMatch(/^\*3\r\n/);
    });
  });

  describe('차집합 저장 (SDIFFSTORE)', () => {
    it('SDIFFSTORE로 차집합 결과를 저장한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c']);
      const result = await handler.execute(['SDIFFSTORE', 'dest', 's1', 's2']);
      expect(result).toBe(':1\r\n');

      const destMembers = await handler.execute(['SMEMBERS', 'dest']);
      expect(destMembers).toContain('a');
    });

    it('빈 결과 저장 시 대상 키가 삭제된다', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      await handler.execute(['SADD', 's2', 'a']);
      await handler.execute(['SDIFFSTORE', 'dest', 's1', 's2']);
      const typeResult = await handler.execute(['TYPE', 'dest']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('교집합 저장 (SINTERSTORE)', () => {
    it('SINTERSTORE로 교집합 결과를 저장한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c', 'd']);
      const result = await handler.execute(['SINTERSTORE', 'dest', 's1', 's2']);
      expect(result).toBe(':2\r\n');

      const destMembers = await handler.execute(['SMEMBERS', 'dest']);
      expect(destMembers).toContain('b');
      expect(destMembers).toContain('c');
    });

    it('빈 결과 저장 시 대상 키가 삭제된다', async () => {
      await handler.execute(['SADD', 's1', 'a']);
      await handler.execute(['SADD', 's2', 'b']);
      await handler.execute(['SINTERSTORE', 'dest', 's1', 's2']);
      const typeResult = await handler.execute(['TYPE', 'dest']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('합집합 저장 (SUNIONSTORE)', () => {
    it('SUNIONSTORE로 합집합 결과를 저장한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b']);
      await handler.execute(['SADD', 's2', 'b', 'c']);
      const result = await handler.execute(['SUNIONSTORE', 'dest', 's1', 's2']);
      expect(result).toBe(':3\r\n');

      const destMembers = await handler.execute(['SMEMBERS', 'dest']);
      expect(destMembers).toContain('a');
      expect(destMembers).toContain('b');
      expect(destMembers).toContain('c');
    });

    it('빈 결과 저장 시 대상 키가 삭제된다', async () => {
      await handler.execute(['SUNIONSTORE', 'dest', 'noset1', 'noset2']);
      const typeResult = await handler.execute(['TYPE', 'dest']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('교집합 카디널리티 (SINTERCARD)', () => {
    it('SINTERCARD로 교집합의 멤버 수를 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c']);
      await handler.execute(['SADD', 's2', 'b', 'c', 'd']);
      const result = await handler.execute(['SINTERCARD', '2', 's1', 's2']);
      expect(result).toBe(':2\r\n');
    });

    it('LIMIT 옵션 — limit에 도달하면 카운트를 중지한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b', 'c', 'd']);
      await handler.execute(['SADD', 's2', 'a', 'b', 'c', 'd']);
      const result = await handler.execute(['SINTERCARD', '2', 's1', 's2', 'LIMIT', '2']);
      expect(result).toBe(':2\r\n');
    });

    it('LIMIT가 교집합보다 크면 실제 교집합 크기를 반환한다', async () => {
      await handler.execute(['SADD', 's1', 'a', 'b']);
      await handler.execute(['SADD', 's2', 'a', 'b']);
      const result = await handler.execute(['SINTERCARD', '2', 's1', 's2', 'LIMIT', '10']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('세트 스캔 (SSCAN)', () => {
    it('SSCAN으로 기본 스캔 — 멤버를 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c']);
      const result = await handler.execute(['SSCAN', 'myset', '0']);
      expect(result).toMatch(/^\*2\r\n/);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('MATCH 패턴으로 필터링한다', async () => {
      await handler.execute(['SADD', 'myset', 'apple', 'banana', 'avocado']);
      const result = await handler.execute(['SSCAN', 'myset', '0', 'MATCH', 'a*']);
      expect(result).toContain('apple');
      expect(result).toContain('avocado');
      expect(result).not.toContain('banana');
    });

    it('COUNT 옵션으로 페이지 크기를 설정한다', async () => {
      await handler.execute(['SADD', 'myset', 'a', 'b', 'c', 'd', 'e']);
      const result = await handler.execute(['SSCAN', 'myset', '0', 'COUNT', '3']);
      expect(result).toMatch(/^\*2\r\n/);
    });

    it('존재하지 않는 키 스캔 — cursor 0, 빈 배열 반환', async () => {
      const result = await handler.execute(['SSCAN', 'noset', '0']);
      expect(result).toMatch(/^\*2\r\n/);
      expect(result).toContain('$1\r\n0\r\n');
      expect(result).toContain('*0\r\n');
    });
  });

  describe('WRONGTYPE 오류', () => {
    it('문자열 키에 세트 명령을 사용하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'strkey', 'value']);
      const result = await handler.execute(['SADD', 'strkey', 'member']);
      expect(result).toContain('WRONGTYPE');
    });

    it('해시 키에 세트 명령을 사용하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'hashkey', 'f1', 'v1']);
      const result = await handler.execute(['SMEMBERS', 'hashkey']);
      expect(result).toContain('WRONGTYPE');
    });

    it('리스트 키에 세트 명령을 사용하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['LPUSH', 'listkey', 'elem']);
      const result = await handler.execute(['SCARD', 'listkey']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('TYPE 명령으로 set 타입 확인', () => {
    it('SADD 후 TYPE이 set을 반환한다', async () => {
      await handler.execute(['SADD', 'myset', 'a']);
      const result = await handler.execute(['TYPE', 'myset']);
      expect(result).toBe('+set\r\n');
    });
  });
});
