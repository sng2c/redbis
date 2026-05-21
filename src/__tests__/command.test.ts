import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';

describe('CommandHandler', () => {
  let handler: CommandHandler;
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    handler = new CommandHandler(storage);
  });

  describe('PING', () => {
    it('인자 없이 PING을 호출하면 +PONG을 반환한다', async () => {
      const result = await handler.execute(['PING']);
      expect(result).toBe('+PONG\r\n');
    });

    it('인자와 함께 PING을 호출하면 bulk string으로 반환한다', async () => {
      const result = await handler.execute(['PING', 'hello']);
      expect(result).toBe('$5\r\nhello\r\n');
    });

    it('소문자 ping도 동작한다', async () => {
      const result = await handler.execute(['ping']);
      expect(result).toBe('+PONG\r\n');
    });
  });

  describe('SET', () => {
    it('키와 값을 설정하고 +OK를 반환한다', async () => {
      const result = await handler.execute(['SET', 'mykey', 'myvalue']);
      expect(result).toBe('+OK\r\n');
    });

    it('인자가 부족하면 에러를 반환한다', async () => {
      const result = await handler.execute(['SET', 'mykey']);
      expect(result).toBe("-ERR wrong number of arguments for 'SET' command\r\n");
    });
  });

  describe('GET', () => {
    it('존재하는 키의 값을 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'myvalue']);
      const result = await handler.execute(['GET', 'mykey']);
      expect(result).toBe('$7\r\nmyvalue\r\n');
    });

    it('존재하지 않는 키는 null bulk string을 반환한다', async () => {
      const result = await handler.execute(['GET', 'nonexistent']);
      expect(result).toBe('$-1\r\n');
    });

    it('인자가 없으면 에러를 반환한다', async () => {
      const result = await handler.execute(['GET']);
      expect(result).toBe("-ERR wrong number of arguments for 'GET' command\r\n");
    });

    it('인자가 너무 많으면 에러를 반환한다', async () => {
      const result = await handler.execute(['GET', 'key1', 'key2']);
      expect(result).toBe("-ERR wrong number of arguments for 'GET' command\r\n");
    });
  });

  describe('DEL', () => {
    it('존재하는 키를 삭제하고 1을 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'myvalue']);
      const result = await handler.execute(['DEL', 'mykey']);
      expect(result).toBe(':1\r\n');
    });

    it('존재하지 않는 키를 삭제하면 0을 반환한다', async () => {
      const result = await handler.execute(['DEL', 'nonexistent']);
      expect(result).toBe(':0\r\n');
    });

    it('여러 키 중 존재하는 키의 개수를 반환한다', async () => {
      await handler.execute(['SET', 'key1', 'val1']);
      await handler.execute(['SET', 'key2', 'val2']);
      const result = await handler.execute(['DEL', 'key1', 'key2', 'key3']);
      expect(result).toBe(':2\r\n');
    });

    it('인자가 없으면 에러를 반환한다', async () => {
      const result = await handler.execute(['DEL']);
      expect(result).toBe("-ERR wrong number of arguments for 'DEL' command\r\n");
    });
  });

  describe('KEYS', () => {
    it('h* 패턴으로 일치하는 키를 반환한다', async () => {
      await handler.execute(['SET', 'hello', 'val1']);
      await handler.execute(['SET', 'hallo', 'val2']);
      await handler.execute(['SET', 'other', 'val3']);
      const result = await handler.execute(['KEYS', 'h*']);
      expect(result).toContain('hello');
      expect(result).toContain('hallo');
      expect(result).not.toContain('other');
    });

    it('* 패턴으로 모든 키를 반환한다', async () => {
      await handler.execute(['SET', 'key1', 'val1']);
      await handler.execute(['SET', 'key2', 'val2']);
      const result = await handler.execute(['KEYS', '*']);
      expect(result).toContain('key1');
      expect(result).toContain('key2');
    });

    it('일치하는 키가 없으면 빈 배열을 반환한다', async () => {
      const result = await handler.execute(['KEYS', 'nomatch*']);
      expect(result).toBe('*0\r\n');
    });

    it('인자가 없으면 에러를 반환한다', async () => {
      const result = await handler.execute(['KEYS']);
      expect(result).toBe("-ERR wrong number of arguments for 'KEYS' command\r\n");
    });

    it('? 와일드카드로 단일 문자를 매칭한다', async () => {
      await handler.execute(['SET', 'hello', 'val1']);
      await handler.execute(['SET', 'hallo', 'val2']);
      await handler.execute(['SET', 'heallo', 'val3']);
      const result = await handler.execute(['KEYS', 'h?llo']);
      expect(result).toContain('hello');
      expect(result).toContain('hallo');
      expect(result).not.toContain('heallo');
    });
  });

  describe('EXISTS', () => {
    it('존재하는 키에 대해 1을 반환한다', async () => {
      await handler.execute(['SET', 'mykey', 'myvalue']);
      const result = await handler.execute(['EXISTS', 'mykey']);
      expect(result).toBe(':1\r\n');
    });

    it('존재하지 않는 키에 대해 0을 반환한다', async () => {
      const result = await handler.execute(['EXISTS', 'nonexistent']);
      expect(result).toBe(':0\r\n');
    });

    it('여러 키 중 존재하는 키의 개수를 반환한다', async () => {
      await handler.execute(['SET', 'key1', 'val1']);
      await handler.execute(['SET', 'key2', 'val2']);
      const result = await handler.execute(['EXISTS', 'key1', 'key2', 'key3']);
      expect(result).toBe(':2\r\n');
    });

    it('인자가 없으면 에러를 반환한다', async () => {
      const result = await handler.execute(['EXISTS']);
      expect(result).toBe("-ERR wrong number of arguments for 'EXISTS' command\r\n");
    });
  });

  describe('FLUSHDB', () => {
    it('데이터베이스를 플러시하고 +OK를 반환한다', async () => {
      await handler.execute(['SET', 'key1', 'val1']);
      const result = await handler.execute(['FLUSHDB']);
      expect(result).toBe('+OK\r\n');
    });
  });

  describe('COMMAND', () => {
    it('지원하는 명령 목록을 반환한다', async () => {
      const result = await handler.execute(['COMMAND']);
      expect(result).toMatch(/^\*\d+\r\n/);
      expect(result).toContain('PING');
      expect(result).toContain('SET');
      expect(result).toContain('GET');
    });
  });

  describe('알 수 없는 명령', () => {
    it('알 수 없는 명령에 에러를 반환한다 (대문자)', async () => {
      const result = await handler.execute(['UNKNOWNCMD']);
      expect(result).toBe("-ERR unknown command 'UNKNOWNCMD'\r\n");
    });

    it('알 수 없는 명령에 에러를 반환한다 (소문자)', async () => {
      const result = await handler.execute(['foobar']);
      expect(result).toBe("-ERR unknown command 'foobar'\r\n");
    });
  });

  describe('빈 인자', () => {
    it('빈 인자 배열에 에러를 반환한다', async () => {
      const result = await handler.execute([]);
      expect(result).toBe('-ERR unknown command\r\n');
    });
  });
});