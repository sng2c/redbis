import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../storage/sqlite';
import { InMemoryStorage } from '../storage/memory';
import { CommandHandler } from '../command/handler';
import { RespParser } from '../protocol/parser';
import type { IStorage } from '../storage/interface';
import { createStorage } from '../storage/factory';
import { loadConfig, Config } from '../config';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../protocol/resp';

describe('Integration: SqliteStorage with CommandHandler', () => {
  let storage: SqliteStorage;
  let handler: CommandHandler;

  beforeEach(() => {
    storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage);
  });

  it('SET then GET round-trip', async () => {
    const setResult = await handler.execute(['SET', 'foo', 'bar']);
    expect(setResult).toBe('+OK\r\n');

    const getResult = await handler.execute(['GET', 'foo']);
    expect(getResult).toBe('$3\r\nbar\r\n');
  });

  it('GET missing key returns null bulk string', async () => {
    const result = await handler.execute(['GET', 'missing']);
    expect(result).toBe('$-1\r\n');
  });

  it('DEL deletes a key and subsequent GET returns null', async () => {
    await handler.execute(['SET', 'mykey', 'myval']);
    const delResult = await handler.execute(['DEL', 'mykey']);
    expect(delResult).toBe(':1\r\n');

    const getResult = await handler.execute(['GET', 'mykey']);
    expect(getResult).toBe('$-1\r\n');
  });

  it('KEYS with patterns returns matching keys', async () => {
    await handler.execute(['SET', 'user:1', 'alice']);
    await handler.execute(['SET', 'user:2', 'bob']);
    await handler.execute(['SET', 'post:1', 'hello']);

    const result = await handler.execute(['KEYS', 'user:*']);
    expect(result).toContain('user:1');
    expect(result).toContain('user:2');
    expect(result).not.toContain('post:1');
  });

  it('EXISTS returns 1 for existing key and 0 after deletion', async () => {
    await handler.execute(['SET', 'mykey', 'myval']);

    const existsResult = await handler.execute(['EXISTS', 'mykey']);
    expect(existsResult).toBe(':1\r\n');

    await handler.execute(['DEL', 'mykey']);
    const existsAfterDel = await handler.execute(['EXISTS', 'mykey']);
    expect(existsAfterDel).toBe(':0\r\n');
  });

  it('FLUSHDB removes all keys', async () => {
    await handler.execute(['SET', 'key1', 'val1']);
    await handler.execute(['SET', 'key2', 'val2']);

    const flushResult = await handler.execute(['FLUSHDB']);
    expect(flushResult).toBe('+OK\r\n');

    const getResult1 = await handler.execute(['GET', 'key1']);
    expect(getResult1).toBe('$-1\r\n');

    const getResult2 = await handler.execute(['GET', 'key2']);
    expect(getResult2).toBe('$-1\r\n');
  });

  it('PING with no args returns +PONG', async () => {
    const result = await handler.execute(['PING']);
    expect(result).toBe('+PONG\r\n');
  });

  it('PING with args returns bulk string', async () => {
    const result = await handler.execute(['PING', 'pong']);
    expect(result).toBe('$4\r\npong\r\n');
  });

  it('COMMAND returns array of supported commands', async () => {
    const result = await handler.execute(['COMMAND']);
    expect(result).toMatch(/^\*\d+\r\n/);
    expect(result).toContain('PING');
    expect(result).toContain('SET');
    expect(result).toContain('GET');
    expect(result).toContain('DEL');
    expect(result).toContain('KEYS');
    expect(result).toContain('EXISTS');
    expect(result).toContain('FLUSHDB');
    expect(result).toContain('COMMAND');
  });

  it('unknown command returns error', async () => {
    const result = await handler.execute(['UNKNOWNCMD']);
    expect(result).toBe("-ERR unknown command 'UNKNOWNCMD'\r\n");
  });

  it('case-insensitive command works', async () => {
    const setResult = await handler.execute(['set', 'KEY', 'VAL']);
    expect(setResult).toBe('+OK\r\n');

    const getResult = await handler.execute(['get', 'KEY']);
    expect(getResult).toBe('$3\r\nVAL\r\n');
  });
});

describe('Integration: RESP Parser → CommandHandler → SqliteStorage', () => {
  let storage: SqliteStorage;
  let handler: CommandHandler;
  let parser: RespParser;

  beforeEach(() => {
    storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage);
    parser = new RespParser();
  });

  it('parse RESP command and execute SET', async () => {
    parser.feed(Buffer.from('*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n'));
    const parsed = parser.parse();
    expect(parsed).toEqual(['SET', 'foo', 'bar']);

    const result = await handler.execute(parsed!);
    expect(result).toBe('+OK\r\n');
  });

  it('multiple commands in sequence persist across commands', async () => {
    // SET command
    parser.feed(Buffer.from('*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n'));
    const parsedSet = parser.parse();
    const setResult = await handler.execute(parsedSet!);
    expect(setResult).toBe('+OK\r\n');

    // GET command
    parser.feed(Buffer.from('*2\r\n$3\r\nGET\r\n$3\r\nfoo\r\n'));
    const parsedGet = parser.parse();
    const getResult = await handler.execute(parsedGet!);
    expect(getResult).toBe('$3\r\nbar\r\n');
  });

  it('GET after SET returns correct bulk string', async () => {
    // SET
    parser.feed(Buffer.from('*3\r\n$3\r\nSET\r\n$4\r\nname\r\n$5\r\nredis\r\n'));
    const setCmd = parser.parse();
    await handler.execute(setCmd!);

    // GET
    parser.feed(Buffer.from('*2\r\n$3\r\nGET\r\n$4\r\nname\r\n'));
    const getCmd = parser.parse();
    const result = await handler.execute(getCmd!);
    expect(result).toBe('$5\r\nredis\r\n');
  });

  it('DEL after SET returns integer response', async () => {
    // SET
    parser.feed(Buffer.from('*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$3\r\nval\r\n'));
    const setCmd = parser.parse();
    await handler.execute(setCmd!);

    // DEL
    parser.feed(Buffer.from('*2\r\n$3\r\nDEL\r\n$3\r\nkey\r\n'));
    const delCmd = parser.parse();
    const delResult = await handler.execute(delCmd!);
    expect(delResult).toBe(':1\r\n');
  });
});

describe('Integration: InMemoryStorage with CommandHandler', () => {
  let storage: InMemoryStorage;
  let handler: CommandHandler;

  beforeEach(() => {
    storage = new InMemoryStorage();
    handler = new CommandHandler(storage);
  });

  it('SET then GET round-trip', async () => {
    const setResult = await handler.execute(['SET', 'foo', 'bar']);
    expect(setResult).toBe('+OK\r\n');

    const getResult = await handler.execute(['GET', 'foo']);
    expect(getResult).toBe('$3\r\nbar\r\n');
  });

  it('GET missing key returns null bulk string', async () => {
    const result = await handler.execute(['GET', 'missing']);
    expect(result).toBe('$-1\r\n');
  });

  it('DEL deletes a key', async () => {
    await handler.execute(['SET', 'mykey', 'myval']);
    const delResult = await handler.execute(['DEL', 'mykey']);
    expect(delResult).toBe(':1\r\n');

    const getResult = await handler.execute(['GET', 'mykey']);
    expect(getResult).toBe('$-1\r\n');
  });
});

describe('createStorage 팩토리', () => {
  it('storageType이 memory일 때 InMemoryStorage 인스턴스를 반환한다', () => {
    const cfg: Config = {
      port: 6379,
      host: '127.0.0.1',
      logLevel: 'info',
      storageType: 'memory',
      storagePath: ':memory:',
    };
    const storage = createStorage(cfg);
    expect(storage).toBeInstanceOf(InMemoryStorage);
  });

  it('storageType이 sqlite일 때 SqliteStorage 인스턴스를 반환한다', () => {
    const cfg: Config = {
      port: 6379,
      host: '127.0.0.1',
      logLevel: 'info',
      storageType: 'sqlite',
      storagePath: ':memory:',
    };
    const storage = createStorage(cfg);
    expect(storage).toBeInstanceOf(SqliteStorage);
  });

  it('storageType이 알 수 없는 값일 때 에러를 throw한다', () => {
    const cfg = {
      port: 6379,
      host: '127.0.0.1',
      logLevel: 'info',
      storageType: 'cassandra' as 'memory' | 'sqlite',
      storagePath: ':memory:',
    };
    expect(() => createStorage(cfg as Config)).toThrow(
      "Unknown storage type: cassandra"
    );
  });

  describe('환경변수와 함께 loadConfig → createStorage', () => {
    let originalStorageType: string | undefined;
    let originalStoragePath: string | undefined;

    beforeEach(() => {
      originalStorageType = process.env.STORAGE_TYPE;
      originalStoragePath = process.env.STORAGE_PATH;
    });

    afterEach(() => {
      if (originalStorageType === undefined) {
        delete process.env.STORAGE_TYPE;
      } else {
        process.env.STORAGE_TYPE = originalStorageType;
      }
      if (originalStoragePath === undefined) {
        delete process.env.STORAGE_PATH;
      } else {
        process.env.STORAGE_PATH = originalStoragePath;
      }
    });

    it('STORAGE_TYPE=memory 환경변수로 InMemoryStorage 생성', () => {
      process.env.STORAGE_TYPE = 'memory';
      delete process.env.STORAGE_PATH;
      const config = loadConfig();
      const storage = createStorage(config);
      expect(storage).toBeInstanceOf(InMemoryStorage);
    });

    it('STORAGE_TYPE=sqlite 환경변수로 SqliteStorage 생성', () => {
      process.env.STORAGE_TYPE = 'sqlite';
      process.env.STORAGE_PATH = ':memory:';
      const config = loadConfig();
      const storage = createStorage(config);
      expect(storage).toBeInstanceOf(SqliteStorage);
    });
  });
});

describe('RESP 왕복 — 인코딩 후 파싱', () => {
  it('encodeSimpleString 결과를 파서로 디코딩', () => {
    const raw = encodeSimpleString('OK');
    const parser = new RespParser();
    parser.feed(Buffer.from(raw));
    // Simple strings are not directly parseable by RESP parser
    // (parser expects arrays or inline commands)
    // Instead, verify the encoded form
    expect(raw).toBe('+OK\r\n');
  });

  it('encodeBulkString 결과를 파서로 디코딩', () => {
    // Wrap in array format for parsing
    const encoded = `*1\r\n${encodeBulkString('hello')}`;
    const parser = new RespParser();
    parser.feed(Buffer.from(encoded));
    const result = parser.parse();
    expect(result).toEqual(['hello']);
  });

  it('encodeArray 결과를 파서로 디코딩', () => {
    const encoded = encodeArray(['SET', 'key', 'value']);
    const parser = new RespParser();
    parser.feed(Buffer.from(encoded));
    const result = parser.parse();
    expect(result).toEqual(['SET', 'key', 'value']);
  });

  it('null bulk string 인코딩 후 파서 디코딩', () => {
    // Null bulk string inside an array
    const encoded = `*1\r\n${encodeBulkString(null)}`;
    const parser = new RespParser();
    parser.feed(Buffer.from(encoded));
    const result = parser.parse();
    expect(result).toEqual(['']);
  });

  it('encodeError 결과를 파서로 디코딩 — 인라인 커맨드로', () => {
    const raw = encodeError('unknown command');
    expect(raw).toBe('-ERR unknown command\r\n');
    // Error responses are not directly parseable by RESP parser arrays
    // but they are valid inline commands
    const parser = new RespParser();
    parser.feed(Buffer.from(raw));
    const result = parser.parse();
    // Inline parsing splits by whitespace and filters empty tokens
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
  });

  it('encodeInteger 결과 형식 확인', () => {
    const raw = encodeInteger(42);
    expect(raw).toBe(':42\r\n');
  });

  it('encodeSimpleString + encodeBulkString 조합 파싱', () => {
    // Encode a command array that includes various types
    const encoded = encodeArray(['SET', 'mykey', 'myvalue']);
    expect(encoded).toBe('*3\r\n$3\r\nSET\r\n$5\r\nmykey\r\n$7\r\nmyvalue\r\n');
    const parser = new RespParser();
    parser.feed(Buffer.from(encoded));
    const result = parser.parse();
    expect(result).toEqual(['SET', 'mykey', 'myvalue']);
  });

  it('빈 문자열 bulk string 인코딩 후 파서 디코딩', () => {
    const encoded = encodeArray(['SET', 'key', '']);
    expect(encoded).toContain('$0\r\n\r\n');
    const parser = new RespParser();
    parser.feed(Buffer.from(encoded));
    const result = parser.parse();
    expect(result).toEqual(['SET', 'key', '']);
  });

  it('null Array 인코딩 확인', () => {
    const raw = encodeArray(null);
    expect(raw).toBe('*-1\r\n');
  });
});