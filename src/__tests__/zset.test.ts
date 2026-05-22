import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';

// ========================================
// InMemoryStorage Sorted Set Tests
// ========================================

describe('정렬 세트(Sorted Set) 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage);
  });

  describe('ZADD: 멤버 추가 및 옵션', () => {
    it('ZADD로 멤버를 추가하고 추가된 수를 반환한다', async () => {
      const result = await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      expect(result).toBe(':3\r\n');
    });

    it('중복 멤버 추가 시 추가 수는 0이고 스코어는 갱신된다', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZADD', 'zs', '5', 'a']);
      expect(result).toBe(':0\r\n');
      const score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n5\r\n');
    });

    it('NX 플래그 — 새 멤버만 추가, 기존 멤버는 무시', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZADD', 'zs', 'NX', '10', 'a', '3', 'c']);
      expect(result).toBe(':1\r\n');
      const score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n1\r\n');
    });

    it('XX 플래그 — 기존 멤버만 갱신, 새 멤버는 무시', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      const result = await handler.execute(['ZADD', 'zs', 'XX', '10', 'a', '3', 'b']);
      expect(result).toBe(':0\r\n');
      const score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$2\r\n10\r\n');
      const scoreB = await handler.execute(['ZSCORE', 'zs', 'b']);
      expect(scoreB).toBe('$-1\r\n');
    });

    it('GT 플래그 — 새 스코어가 더 클 때만 갱신', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      await handler.execute(['ZADD', 'zs', 'GT', '3', 'a']);
      let score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n5\r\n');
      await handler.execute(['ZADD', 'zs', 'GT', '10', 'a']);
      score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$2\r\n10\r\n');
    });

    it('LT 플래그 — 새 스코어가 더 작을 때만 갱신', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      await handler.execute(['ZADD', 'zs', 'LT', '10', 'a']);
      let score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n5\r\n');
      await handler.execute(['ZADD', 'zs', 'LT', '3', 'a']);
      score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n3\r\n');
    });

    it('CH 플래그 — 변경된 수(새 + 갱신)를 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZADD', 'zs', 'CH', '10', 'a', '3', 'c']);
      expect(result).toBe(':2\r\n');
    });

    it('INCR 플래그 — 스코어 증가 후 bulk string 반환', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      const result = await handler.execute(['ZADD', 'zs', 'INCR', '3', 'a']);
      expect(result).toBe('$1\r\n8\r\n');
    });

    it('INCR 플래그 — NX와 함께 존재하지 않는 멤버는 새로 생성', async () => {
      const result = await handler.execute(['ZADD', 'zs', 'NX', 'INCR', '3', 'a']);
      expect(result).toBe('$1\r\n3\r\n');
    });

    it('INCR 플래그 — NX와 함께 이미 존재하면 null 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      const result = await handler.execute(['ZADD', 'zs', 'NX', 'INCR', '3', 'a']);
      expect(result).toBe('$-1\r\n');
    });

    it('INCR 플래그 — XX와 함께 존재하지 않으면 null 반환', async () => {
      const result = await handler.execute(['ZADD', 'zs', 'XX', 'INCR', '3', 'a']);
      expect(result).toBe('$-1\r\n');
    });

    it('INCR with multiple score-members → error', async () => {
      const result = await handler.execute(['ZADD', 'zs', 'INCR', '1', 'a', '2', 'b']);
      expect(result).toContain('ERR');
    });

    it('인자 부족 시 에러 반환', async () => {
      const result = await handler.execute(['ZADD', 'zs']);
      expect(result).toContain('ERR');
    });
  });

  describe('ZREM: 멤버 삭제', () => {
    it('기존 멤버 삭제 시 삭제된 수 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREM', 'zs', 'a', 'b']);
      expect(result).toBe(':2\r\n');
    });

    it('존재하지 않는 멤버 삭제 시 0 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      const result = await handler.execute(['ZREM', 'zs', 'z']);
      expect(result).toBe(':0\r\n');
    });

    it('모든 멤버 삭제 시 키가 사라진다', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      await handler.execute(['ZREM', 'zs', 'a']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('ZSCORE / ZMSCORE: 스코어 조회', () => {
    it('ZSCORE로 기존 멤버의 스코어를 반환', async () => {
      await handler.execute(['ZADD', 'zs', '3.5', 'a']);
      const result = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(result).toBe('$3\r\n3.5\r\n');
    });

    it('ZSCORE로 존재하지 않는 멤버는 null 반환', async () => {
      const result = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(result).toBe('$-1\r\n');
    });

    it('ZMSCORE로 여러 멤버 스코어를 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZMSCORE', 'zs', 'a', 'b', 'c']);
      expect(result).toContain('$1\r\n1\r\n');
      expect(result).toContain('$1\r\n2\r\n');
      expect(result).toContain('$-1\r\n');
      expect(result).toMatch(/^\*3\r\n/);
    });
  });

  describe('ZCARD: 멤버 수 조회', () => {
    it('ZCARD로 멤버 수를 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZCARD', 'zs']);
      expect(result).toBe(':3\r\n');
    });

    it('존재하지 않는 키에 ZCARD → 0', async () => {
      const result = await handler.execute(['ZCARD', 'nokey']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('ZRANGE / ZREVRANGE: 인덱스 범위 조회', () => {
    it('ZRANGE로 인덱스 범위 조회', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANGE', 'zs', '0', '1']);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).not.toContain('c');
    });

    it('ZRANGE WITHSCORES', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZRANGE', 'zs', '0', '-1', 'WITHSCORES']);
      expect(result).toContain('a');
      expect(result).toContain('1');
      expect(result).toContain('b');
      expect(result).toContain('2');
    });

    it('ZREVRANGE로 역순 조회', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREVRANGE', 'zs', '0', '1']);
      expect(result).toContain('c');
      expect(result).toContain('b');
      expect(result).not.toContain('a');
    });

    it('ZREVRANGE WITHSCORES', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZREVRANGE', 'zs', '0', '-1', 'WITHSCORES']);
      expect(result).toContain('b');
      expect(result).toContain('2');
      expect(result).toContain('a');
      expect(result).toContain('1');
    });

    it('범위 초과 시 빈 배열 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      const result = await handler.execute(['ZRANGE', 'zs', '5', '10']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('ZRANGEBYSCORE / ZREVRANGEBYSCORE: 스코어 범위 조회', () => {
    it('ZRANGEBYSCORE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c', '4', 'd']);
      const result = await handler.execute(['ZRANGEBYSCORE', 'zs', '2', '3']);
      expect(result).toContain('b');
      expect(result).toContain('c');
      expect(result).not.toContain('a');
      expect(result).not.toContain('d');
    });

    it('ZRANGEBYSCORE -inf +inf', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '5', 'b']);
      const result = await handler.execute(['ZRANGEBYSCORE', 'zs', '-inf', '+inf']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('ZRANGEBYSCORE exclusive bound ( prefix', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANGEBYSCORE', 'zs', '(1', '3']);
      expect(result).toContain('b');
      expect(result).toContain('c');
      expect(result).not.toContain('"a"');
    });

    it('ZRANGEBYSCORE WITHSCORES', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZRANGEBYSCORE', 'zs', '1', '2', 'WITHSCORES']);
      expect(result).toContain('a');
      expect(result).toContain('1');
    });

    it('ZRANGEBYSCORE LIMIT', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c', '4', 'd']);
      const result = await handler.execute(['ZRANGEBYSCORE', 'zs', '1', '4', 'LIMIT', '1', '2']);
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZREVRANGEBYSCORE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREVRANGEBYSCORE', 'zs', '3', '1']);
      expect(result).toContain('c');
      expect(result).toContain('b');
      expect(result).toContain('a');
    });
  });

  describe('ZRANGEBYLEX / ZREVRANGEBYLEX: 렉시코그래픽 범위 조회', () => {
    it('ZRANGEBYLEX 기본', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c', '0', 'd']);
      const result = await handler.execute(['ZRANGEBYLEX', 'zs', '[b', '[c']);
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZRANGEBYLEX exclusive ( prefix', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c']);
      const result = await handler.execute(['ZRANGEBYLEX', 'zs', '(a', '(c']);
      expect(result).toContain('b');
      expect(result).not.toContain('a');
      expect(result).not.toContain('c');
    });

    it('ZRANGEBYLEX - + 범위', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b']);
      const result = await handler.execute(['ZRANGEBYLEX', 'zs', '-', '+']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('ZRANGEBYLEX LIMIT', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c', '0', 'd']);
      const result = await handler.execute(['ZRANGEBYLEX', 'zs', '-', '+', 'LIMIT', '1', '2']);
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZREVRANGEBYLEX 기본', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c']);
      const result = await handler.execute(['ZREVRANGEBYLEX', 'zs', '[c', '[a']);
      expect(result).toContain('c');
      expect(result).toContain('b');
      expect(result).toContain('a');
    });
  });

  describe('ZRANK / ZREVRANK: 랭크 조회', () => {
    it('ZRANK 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANK', 'zs', 'b']);
      expect(result).toBe(':1\r\n');
    });

    it('ZREVRANK 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREVRANK', 'zs', 'b']);
      expect(result).toBe(':1\r\n');
    });

    it('존재하지 않는 멤버 → null', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      const result = await handler.execute(['ZRANK', 'zs', 'z']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('ZINCRBY: 스코어 증가', () => {
    it('기존 멤버 스코어 증가', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      const result = await handler.execute(['ZINCRBY', 'zs', '3', 'a']);
      expect(result).toBe('$1\r\n8\r\n');
    });

    it('존재하지 않는 멤버에 ZINCRBY → 0에서 증가', async () => {
      const result = await handler.execute(['ZINCRBY', 'zs', '5', 'a']);
      expect(result).toBe('$1\r\n5\r\n');
    });

    it('음수로 감소', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      const result = await handler.execute(['ZINCRBY', 'zs', '-2', 'a']);
      expect(result).toBe('$1\r\n3\r\n');
    });
  });

  describe('ZCOUNT / ZLEXCOUNT: 범위 카운트', () => {
    it('ZCOUNT 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c', '4', 'd']);
      const result = await handler.execute(['ZCOUNT', 'zs', '2', '3']);
      expect(result).toBe(':2\r\n');
    });

    it('ZCOUNT -inf +inf', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZCOUNT', 'zs', '-inf', '+inf']);
      expect(result).toBe(':2\r\n');
    });

    it('ZLEXCOUNT 기본', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c', '0', 'd']);
      const result = await handler.execute(['ZLEXCOUNT', 'zs', '[b', '[c']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('ZREMRANGEBYRANK / ZREMRANGEBYSCORE / ZREMRANGEBYLEX: 범위 삭제', () => {
    it('ZREMRANGEBYRANK', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREMRANGEBYRANK', 'zs', '0', '1']);
      expect(result).toBe(':2\r\n');
      const card = await handler.execute(['ZCARD', 'zs']);
      expect(card).toBe(':1\r\n');
    });

    it('ZREMRANGEBYSCORE', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREMRANGEBYSCORE', 'zs', '1', '2']);
      expect(result).toBe(':2\r\n');
    });

    it('ZREMRANGEBYLEX', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c', '0', 'd']);
      const result = await handler.execute(['ZREMRANGEBYLEX', 'zs', '[b', '[c']);
      expect(result).toBe(':2\r\n');
    });

    it('모든 멤버 삭제 시 키가 사라진다', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      await handler.execute(['ZREMRANGEBYRANK', 'zs', '0', '-1']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('ZSCAN: 커서 반복', () => {
    it('ZSCAN 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZSCAN', 'zs', '0']);
      expect(result).toMatch(/^\*2\r\n/);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZSCAN MATCH 패턴', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'apple', '2', 'banana', '3', 'avocado']);
      const result = await handler.execute(['ZSCAN', 'zs', '0', 'MATCH', 'a*']);
      expect(result).toContain('apple');
      expect(result).toContain('avocado');
    });

    it('ZSCAN COUNT', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZSCAN', 'zs', '0', 'COUNT', '2']);
      expect(result).toMatch(/^\*2\r\n/);
    });
  });

  describe('ZPOPMAX / ZPOPMIN: 최대/최소 팝', () => {
    it('ZPOPMAX 기본 — 최고 스코어 멤버 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZPOPMAX', 'zs']);
      expect(result).toContain('c');
      expect(result).toContain('3');
    });

    it('ZPOPMAX count — 여러 멤버 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZPOPMAX', 'zs', '2']);
      expect(result).toContain('c');
      expect(result).toContain('b');
    });

    it('ZPOPMIN 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZPOPMIN', 'zs']);
      expect(result).toContain('a');
      expect(result).toContain('1');
    });

    it('빈 키에 ZPOPMAX → null', async () => {
      const result = await handler.execute(['ZPOPMAX', 'zs']);
      expect(result).toBe('$-1\r\n');
    });

    it('빈 키에 ZPOPMAX count → 빈 배열', async () => {
      const result = await handler.execute(['ZPOPMAX', 'zs', '3']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('ZRANDMEMBER: 무작위 멤버', () => {
    it('ZRANDMEMBER 단일 — 멤버 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANDMEMBER', 'zs']);
      // result is a bulk string (one of the members)
      expect(result).toMatch(/^\$\d\r\n/);
    });

    it('빈 키에 ZRANDMEMBER → null', async () => {
      const result = await handler.execute(['ZRANDMEMBER', 'zs']);
      expect(result).toBe('$-1\r\n');
    });

    it('ZRANDMEMBER count', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANDMEMBER', 'zs', '2']);
      expect(result).toMatch(/^\*2\r\n/);
    });

    it('ZRANDMEMBER 음수 count — 중복 허용', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZRANDMEMBER', 'zs', '-5']);
      expect(result).toMatch(/^\*5\r\n/);
    });

    it('ZRANDMEMBER WITHSCORES', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZRANDMEMBER', 'zs', '2', 'WITHSCORES']);
      expect(result).toMatch(/^\*4\r\n/);
    });
  });

  describe('ZRANGESTORE: 범위 저장', () => {
    it('ZRANGESTORE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANGESTORE', 'zd', 'zs', '0', '1']);
      expect(result).toBe(':2\r\n');
      const card = await handler.execute(['ZCARD', 'zd']);
      expect(card).toBe(':2\r\n');
    });

    it('빈 범위 → destination 삭제', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      await handler.execute(['ZADD', 'zd', '5', 'x']);
      await handler.execute(['ZRANGESTORE', 'zd', 'zs', '10', '20']);
      const typeResult = await handler.execute(['TYPE', 'zd']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('ZRANGESTORE BYSCORE', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANGESTORE', 'zd', 'zs', '1', '2', 'BYSCORE']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('ZDIFF / ZDIFFSTORE: 차집합', () => {
    it('ZDIFF 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b', '3', 'c']);
      await handler.execute(['ZADD', 'z2', '1', 'a']);
      const result = await handler.execute(['ZDIFF', '2', 'z1', 'z2']);
      expect(result).toContain('b');
      expect(result).toContain('c');
      expect(result).not.toContain('"a"');
    });

    it('ZDIFF WITHSCORES', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZDIFF', '1', 'z1', 'WITHSCORES']);
      expect(result).toContain('a');
      expect(result).toContain('1');
      expect(result).toContain('b');
      expect(result).toContain('2');
    });

    it('ZDIFFSTORE', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b', '3', 'c']);
      await handler.execute(['ZADD', 'z2', '1', 'a']);
      const result = await handler.execute(['ZDIFFSTORE', 'zd', '2', 'z1', 'z2']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('ZUNION / ZUNIONSTORE: 합집합', () => {
    it('ZUNION 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b', '4', 'c']);
      const result = await handler.execute(['ZUNION', '2', 'z1', 'z2']);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZUNION WITHSCORES', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a']);
      const result = await handler.execute(['ZUNION', '1', 'z1', 'WITHSCORES']);
      expect(result).toContain('a');
      expect(result).toContain('1');
    });

    it('ZUNION WEIGHTS', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a']);
      await handler.execute(['ZADD', 'z2', '1', 'a']);
      const result = await handler.execute(['ZUNION', '2', 'z1', 'z2', 'WEIGHTS', '2', '3', 'WITHSCORES']);
      // score = 1*2 + 1*3 = 5
      expect(result).toContain('5');
    });

    it('ZUNION AGGREGATE MIN', async () => {
      await handler.execute(['ZADD', 'z1', '5', 'a']);
      await handler.execute(['ZADD', 'z2', '3', 'a']);
      const result = await handler.execute(['ZUNION', '2', 'z1', 'z2', 'AGGREGATE', 'MIN', 'WITHSCORES']);
      expect(result).toContain('3');
    });

    it('ZUNION AGGREGATE MAX', async () => {
      await handler.execute(['ZADD', 'z1', '5', 'a']);
      await handler.execute(['ZADD', 'z2', '3', 'a']);
      const result = await handler.execute(['ZUNION', '2', 'z1', 'z2', 'AGGREGATE', 'MAX', 'WITHSCORES']);
      expect(result).toContain('5');
    });

    it('ZUNIONSTORE', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b', '4', 'c']);
      const result = await handler.execute(['ZUNIONSTORE', 'zd', '2', 'z1', 'z2']);
      expect(result).toBe(':3\r\n');
    });
  });

  describe('ZINTER / ZINTERSTORE / ZINTERCARD: 교집합', () => {
    it('ZINTER 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b', '4', 'c']);
      const result = await handler.execute(['ZINTER', '2', 'z1', 'z2']);
      expect(result).toContain('b');
      expect(result).not.toContain('a');
      expect(result).not.toContain('c');
    });

    it('ZINTER WITHSCORES', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b']);
      const result = await handler.execute(['ZINTER', '2', 'z1', 'z2', 'WITHSCORES']);
      expect(result).toContain('b');
      expect(result).toContain('5'); // 2+3
    });

    it('ZINTER WEIGHTS', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a']);
      await handler.execute(['ZADD', 'z2', '1', 'a']);
      const result = await handler.execute(['ZINTER', '2', 'z1', 'z2', 'WEIGHTS', '2', '3', 'WITHSCORES']);
      expect(result).toContain('5'); // 1*2 + 1*3
    });

    it('ZINTER AGGREGATE MIN', async () => {
      await handler.execute(['ZADD', 'z1', '5', 'a']);
      await handler.execute(['ZADD', 'z2', '3', 'a']);
      const result = await handler.execute(['ZINTER', '2', 'z1', 'z2', 'AGGREGATE', 'MIN', 'WITHSCORES']);
      expect(result).toContain('3');
    });

    it('ZINTERSTORE', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b']);
      const result = await handler.execute(['ZINTERSTORE', 'zd', '2', 'z1', 'z2']);
      expect(result).toBe(':1\r\n');
    });

    it('ZINTERCARD 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b', '4', 'c']);
      const result = await handler.execute(['ZINTERCARD', '2', 'z1', 'z2']);
      expect(result).toBe(':1\r\n');
    });

    it('ZINTERCARD LIMIT', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b', '3', 'c']);
      await handler.execute(['ZADD', 'z2', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZINTERCARD', '2', 'z1', 'z2', 'LIMIT', '2']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('BZPOPMAX / BZPOPMIN: 비차단 팝', () => {
    it('BZPOPMAX — 첫 번째 비어있지 않은 키에서 팝', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '3', 'c']);
      const result = await handler.execute(['BZPOPMAX', 'z1', 'z2', '0']);
      expect(result).toContain('z1');
      expect(result).toContain('c');
      expect(result).toContain('3');
    });

    it('BZPOPMAX — 모든 키 비어있으면 null', async () => {
      const result = await handler.execute(['BZPOPMAX', 'z1', 'z2', '0']);
      expect(result).toBe('*-1\r\n');
    });

    it('BZPOPMIN 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '3', 'c']);
      const result = await handler.execute(['BZPOPMIN', 'z1', '0']);
      expect(result).toContain('a');
      expect(result).toContain('1');
    });
  });

  describe('ZMPOP / BZMPOP: 멀티 팝', () => {
    it('ZMPOP MIN', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZMPOP', '1', 'z1', 'MIN']);
      expect(result).toContain('z1');
      expect(result).toContain('a');
      expect(result).toContain('1');
    });

    it('ZMPOP MAX', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZMPOP', '1', 'z1', 'MAX']);
      expect(result).toContain('z1');
      expect(result).toContain('c');
      expect(result).toContain('3');
    });

    it('ZMPOP COUNT', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZMPOP', '1', 'z1', 'MIN', 'COUNT', '2']);
      expect(result).toContain('z1');
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('ZMPOP 빈 키 → null', async () => {
      const result = await handler.execute(['ZMPOP', '1', 'z1', 'MIN']);
      expect(result).toBe('*-1\r\n');
    });

    it('BZMPOP 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      const result = await handler.execute(['BZMPOP', '1', 'z1', 'MIN']);
      expect(result).toContain('z1');
      expect(result).toContain('a');
    });

    it('BZMPOP 빈 키 → null', async () => {
      const result = await handler.execute(['BZMPOP', '1', 'z1', 'MIN']);
      expect(result).toBe('*-1\r\n');
    });
  });

  describe('WRONGTYPE: 타입 오류', () => {
    it('ZADD on string key → WRONGTYPE', async () => {
      await handler.execute(['SET', 'strkey', 'value']);
      const result = await handler.execute(['ZADD', 'strkey', '1', 'a']);
      expect(result).toContain('WRONGTYPE');
    });

    it('ZRANGE on hash key → WRONGTYPE', async () => {
      await handler.execute(['HSET', 'hashkey', 'f1', 'v1']);
      const result = await handler.execute(['ZRANGE', 'hashkey', '0', '-1']);
      expect(result).toContain('WRONGTYPE');
    });

    it('ZSCORE on list key → WRONGTYPE', async () => {
      await handler.execute(['LPUSH', 'listkey', 'elem']);
      const result = await handler.execute(['ZSCORE', 'listkey', 'elem']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('빈 정렬 세트 정리', () => {
    it('ZREM으로 모든 멤버 삭제 시 TYPE이 none을 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      await handler.execute(['ZREM', 'zs', 'a']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('ZREMRANGEBYRANK로 모든 멤버 삭제 시 TYPE이 none을 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      await handler.execute(['ZREMRANGEBYRANK', 'zs', '0', '-1']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('ZREMRANGEBYSCORE로 모든 멤버 삭제 시 TYPE이 none을 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      await handler.execute(['ZREMRANGEBYSCORE', 'zs', '-inf', '+inf']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('TYPE 명령으로 zset 타입 확인', () => {
    it('ZADD 후 TYPE이 zset을 반환한다', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      const result = await handler.execute(['TYPE', 'zs']);
      expect(result).toBe('+zset\r\n');
    });
  });
});

// ========================================
// SqliteStorage Sorted Set Tests
// ========================================

describe('정렬 세트(Sorted Set) 명령어 — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage);
  });

  describe('ZADD: 멤버 추가 및 옵션', () => {
    it('ZADD로 멤버를 추가하고 추가된 수를 반환한다', async () => {
      const result = await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      expect(result).toBe(':3\r\n');
    });

    it('중복 멤버 추가 시 추가 수는 0이고 스코어는 갱신된다', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZADD', 'zs', '5', 'a']);
      expect(result).toBe(':0\r\n');
      const score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n5\r\n');
    });

    it('NX 플래그 — 새 멤버만 추가', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZADD', 'zs', 'NX', '10', 'a', '3', 'c']);
      expect(result).toBe(':1\r\n');
      const score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n1\r\n');
    });

    it('XX 플래그 — 기존 멤버만 갱신', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      const result = await handler.execute(['ZADD', 'zs', 'XX', '10', 'a', '3', 'b']);
      expect(result).toBe(':0\r\n');
      const score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$2\r\n10\r\n');
    });

    it('GT 플래그 — 새 스코어가 더 클 때만 갱신', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      await handler.execute(['ZADD', 'zs', 'GT', '3', 'a']);
      let score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n5\r\n');
      await handler.execute(['ZADD', 'zs', 'GT', '10', 'a']);
      score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$2\r\n10\r\n');
    });

    it('LT 플래그 — 새 스코어가 더 작을 때만 갱신', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      await handler.execute(['ZADD', 'zs', 'LT', '10', 'a']);
      let score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n5\r\n');
      await handler.execute(['ZADD', 'zs', 'LT', '3', 'a']);
      score = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(score).toBe('$1\r\n3\r\n');
    });

    it('CH 플래그 — 변경된 수 반환', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZADD', 'zs', 'CH', '10', 'a', '3', 'c']);
      expect(result).toBe(':2\r\n');
    });

    it('INCR 플래그 — 스코어 증가', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      const result = await handler.execute(['ZADD', 'zs', 'INCR', '3', 'a']);
      expect(result).toBe('$1\r\n8\r\n');
    });

    it('INCR + XX — 존재하지 않으면 null', async () => {
      const result = await handler.execute(['ZADD', 'zs', 'XX', 'INCR', '3', 'a']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('ZREM: 멤버 삭제', () => {
    it('기존 멤버 삭제', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREM', 'zs', 'a', 'b']);
      expect(result).toBe(':2\r\n');
    });

    it('모든 멤버 삭제 시 키가 사라진다', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      await handler.execute(['ZREM', 'zs', 'a']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('ZSCORE / ZMSCORE: 스코어 조회', () => {
    it('ZSCORE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '3.5', 'a']);
      const result = await handler.execute(['ZSCORE', 'zs', 'a']);
      expect(result).toBe('$3\r\n3.5\r\n');
    });

    it('ZMSCORE 여러 멤버', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZMSCORE', 'zs', 'a', 'c']);
      expect(result).toContain('$1\r\n1\r\n');
      expect(result).toContain('$-1\r\n');
    });
  });

  describe('ZCARD: 멤버 수 조회', () => {
    it('ZCARD 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZCARD', 'zs']);
      expect(result).toBe(':2\r\n');
    });

    it('존재하지 않는 키 → 0', async () => {
      const result = await handler.execute(['ZCARD', 'nokey']);
      expect(result).toBe(':0\r\n');
    });
  });

  describe('ZRANGE / ZREVRANGE: 인덱스 범위 조회', () => {
    it('ZRANGE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANGE', 'zs', '0', '1']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('ZRANGE WITHSCORES', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZRANGE', 'zs', '0', '-1', 'WITHSCORES']);
      expect(result).toContain('a');
      expect(result).toContain('1');
      expect(result).toContain('b');
      expect(result).toContain('2');
    });

    it('ZREVRANGE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREVRANGE', 'zs', '0', '1']);
      expect(result).toContain('c');
      expect(result).toContain('b');
    });
  });

  describe('ZRANGEBYSCORE / ZREVRANGEBYSCORE', () => {
    it('ZRANGEBYSCORE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c', '4', 'd']);
      const result = await handler.execute(['ZRANGEBYSCORE', 'zs', '2', '3']);
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZRANGEBYSCORE -inf +inf', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '5', 'b']);
      const result = await handler.execute(['ZRANGEBYSCORE', 'zs', '-inf', '+inf']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('ZREVRANGEBYSCORE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREVRANGEBYSCORE', 'zs', '3', '1']);
      expect(result).toContain('c');
      expect(result).toContain('b');
    });
  });

  describe('ZRANGEBYLEX / ZREVRANGEBYLEX', () => {
    it('ZRANGEBYLEX 기본', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c', '0', 'd']);
      const result = await handler.execute(['ZRANGEBYLEX', 'zs', '[b', '[c']);
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZREVRANGEBYLEX 기본', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c']);
      const result = await handler.execute(['ZREVRANGEBYLEX', 'zs', '[c', '[a']);
      expect(result).toContain('c');
      expect(result).toContain('a');
    });
  });

  describe('ZRANK / ZREVRANK', () => {
    it('ZRANK 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANK', 'zs', 'b']);
      expect(result).toBe(':1\r\n');
    });

    it('ZREVRANK 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREVRANK', 'zs', 'b']);
      expect(result).toBe(':1\r\n');
    });

    it('존재하지 않는 멤버 → null', async () => {
      const result = await handler.execute(['ZRANK', 'zs', 'z']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('ZINCRBY', () => {
    it('스코어 증가', async () => {
      await handler.execute(['ZADD', 'zs', '5', 'a']);
      const result = await handler.execute(['ZINCRBY', 'zs', '3', 'a']);
      expect(result).toBe('$1\r\n8\r\n');
    });

    it('존재하지 않는 멤버 → 0에서 증가', async () => {
      const result = await handler.execute(['ZINCRBY', 'zs', '5', 'a']);
      expect(result).toBe('$1\r\n5\r\n');
    });
  });

  describe('ZCOUNT / ZLEXCOUNT', () => {
    it('ZCOUNT 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c', '4', 'd']);
      const result = await handler.execute(['ZCOUNT', 'zs', '2', '3']);
      expect(result).toBe(':2\r\n');
    });

    it('ZLEXCOUNT 기본', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c', '0', 'd']);
      const result = await handler.execute(['ZLEXCOUNT', 'zs', '[b', '[c']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('ZREMRANGEBYRANK / ZREMRANGEBYSCORE / ZREMRANGEBYLEX', () => {
    it('ZREMRANGEBYRANK', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREMRANGEBYRANK', 'zs', '0', '1']);
      expect(result).toBe(':2\r\n');
    });

    it('ZREMRANGEBYSCORE', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZREMRANGEBYSCORE', 'zs', '1', '2']);
      expect(result).toBe(':2\r\n');
    });

    it('ZREMRANGEBYLEX', async () => {
      await handler.execute(['ZADD', 'zs', '0', 'a', '0', 'b', '0', 'c', '0', 'd']);
      const result = await handler.execute(['ZREMRANGEBYLEX', 'zs', '[b', '[c']);
      expect(result).toBe(':2\r\n');
    });

    it('모든 멤버 삭제 시 TYPE이 none', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      await handler.execute(['ZREMRANGEBYRANK', 'zs', '0', '-1']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('ZSCAN', () => {
    it('ZSCAN 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZSCAN', 'zs', '0']);
      expect(result).toMatch(/^\*2\r\n/);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });
  });

  describe('ZPOPMAX / ZPOPMIN', () => {
    it('ZPOPMAX 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZPOPMAX', 'zs']);
      expect(result).toContain('c');
    });

    it('ZPOPMIN 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZPOPMIN', 'zs']);
      expect(result).toContain('a');
    });

    it('빈 키 → null', async () => {
      const result = await handler.execute(['ZPOPMAX', 'zs']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('ZRANDMEMBER', () => {
    it('ZRANDMEMBER 단일', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZRANDMEMBER', 'zs']);
      expect(result).toMatch(/^\$\d\r\n/);
    });

    it('빈 키 → null', async () => {
      const result = await handler.execute(['ZRANDMEMBER', 'zs']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('ZRANGESTORE', () => {
    it('ZRANGESTORE 기본', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b', '3', 'c']);
      const result = await handler.execute(['ZRANGESTORE', 'zd', 'zs', '0', '1']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('ZDIFF / ZDIFFSTORE', () => {
    it('ZDIFF 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b', '3', 'c']);
      await handler.execute(['ZADD', 'z2', '1', 'a']);
      const result = await handler.execute(['ZDIFF', '2', 'z1', 'z2']);
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZDIFFSTORE', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b', '3', 'c']);
      await handler.execute(['ZADD', 'z2', '1', 'a']);
      const result = await handler.execute(['ZDIFFSTORE', 'zd', '2', 'z1', 'z2']);
      expect(result).toBe(':2\r\n');
    });
  });

  describe('ZUNION / ZUNIONSTORE', () => {
    it('ZUNION 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b', '4', 'c']);
      const result = await handler.execute(['ZUNION', '2', 'z1', 'z2']);
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('c');
    });

    it('ZUNIONSTORE', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b', '4', 'c']);
      const result = await handler.execute(['ZUNIONSTORE', 'zd', '2', 'z1', 'z2']);
      expect(result).toBe(':3\r\n');
    });
  });

  describe('ZINTER / ZINTERSTORE / ZINTERCARD', () => {
    it('ZINTER 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b', '4', 'c']);
      const result = await handler.execute(['ZINTER', '2', 'z1', 'z2']);
      expect(result).toContain('b');
    });

    it('ZINTERSTORE', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b']);
      const result = await handler.execute(['ZINTERSTORE', 'zd', '2', 'z1', 'z2']);
      expect(result).toBe(':1\r\n');
    });

    it('ZINTERCARD 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      await handler.execute(['ZADD', 'z2', '3', 'b', '4', 'c']);
      const result = await handler.execute(['ZINTERCARD', '2', 'z1', 'z2']);
      expect(result).toBe(':1\r\n');
    });
  });

  describe('BZPOPMAX / BZPOPMIN', () => {
    it('BZPOPMAX 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '3', 'c']);
      const result = await handler.execute(['BZPOPMAX', 'z1', '0']);
      expect(result).toContain('z1');
      expect(result).toContain('c');
    });

    it('BZPOPMAX 빈 키 → null', async () => {
      const result = await handler.execute(['BZPOPMAX', 'z1', '0']);
      expect(result).toBe('*-1\r\n');
    });

    it('BZPOPMIN 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '3', 'c']);
      const result = await handler.execute(['BZPOPMIN', 'z1', '0']);
      expect(result).toContain('a');
    });
  });

  describe('ZMPOP / BZMPOP', () => {
    it('ZMPOP MIN', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a', '2', 'b']);
      const result = await handler.execute(['ZMPOP', '1', 'z1', 'MIN']);
      expect(result).toContain('z1');
      expect(result).toContain('a');
    });

    it('ZMPOP 빈 키 → null', async () => {
      const result = await handler.execute(['ZMPOP', '1', 'z1', 'MIN']);
      expect(result).toBe('*-1\r\n');
    });

    it('BZMPOP 기본', async () => {
      await handler.execute(['ZADD', 'z1', '1', 'a']);
      const result = await handler.execute(['BZMPOP', '1', 'z1', 'MIN']);
      expect(result).toContain('z1');
    });
  });

  describe('WRONGTYPE 오류', () => {
    it('ZADD on string key → WRONGTYPE', async () => {
      await handler.execute(['SET', 'strkey', 'value']);
      const result = await handler.execute(['ZADD', 'strkey', '1', 'a']);
      expect(result).toContain('WRONGTYPE');
    });

    it('ZRANGE on hash key → WRONGTYPE', async () => {
      await handler.execute(['HSET', 'hashkey', 'f1', 'v1']);
      const result = await handler.execute(['ZRANGE', 'hashkey', '0', '-1']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  describe('빈 정렬 세트 정리', () => {
    it('ZREM으로 모든 멤버 삭제 시 TYPE이 none', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      await handler.execute(['ZREM', 'zs', 'a']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('ZREMRANGEBYRANK로 모든 멤버 삭제 시 TYPE이 none', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      await handler.execute(['ZREMRANGEBYRANK', 'zs', '0', '-1']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });

    it('ZREMRANGEBYSCORE로 모든 멤버 삭제 시 TYPE이 none', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a', '2', 'b']);
      await handler.execute(['ZREMRANGEBYSCORE', 'zs', '-inf', '+inf']);
      const typeResult = await handler.execute(['TYPE', 'zs']);
      expect(typeResult).toBe('+none\r\n');
    });
  });

  describe('TYPE 명령으로 zset 타입 확인', () => {
    it('ZADD 후 TYPE이 zset을 반환한다', async () => {
      await handler.execute(['ZADD', 'zs', '1', 'a']);
      const result = await handler.execute(['TYPE', 'zs']);
      expect(result).toBe('+zset\r\n');
    });
  });
});