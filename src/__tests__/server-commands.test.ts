import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage/memory';
import { PubSubManager } from '../pubsub/manager';
import { CommandHandler } from '../command/handler';
import { SqliteStorage } from '../storage/sqlite';

describe('서버 명령어', () => {
  let storage: InMemoryStorage;
  let pubsub: PubSubManager;
  let handler: CommandHandler;

  beforeEach(() => {
    storage = new InMemoryStorage();
    pubsub = new PubSubManager();
    handler = new CommandHandler(storage, pubsub, 'test-conn', () => {});
  });

  // INFO
  it('INFO - 기본 정보 반환', async () => {
    const result = await handler.execute(['INFO']);
    expect(result).toContain('redis_version');
    expect(result).toContain('redis_mode');
  });

  it('INFO server - 서버 섹션만 반환', async () => {
    const result = await handler.execute(['INFO', 'server']);
    expect(result).toContain('redis_version');
  });

  it('INFO keyspace - 키스페이스 섹션 반환', async () => {
    await handler.execute(['SET', 'mykey', 'myvalue']);
    const result = await handler.execute(['INFO', 'keyspace']);
    expect(result).toContain('keys=1');
  });

  // TIME
  it('TIME - 현재 시간 반환', async () => {
    const result = await handler.execute(['TIME']);
    expect(result).toContain('*2');
    const beforeTime = Math.floor(Date.now() / 1000).toString();
    expect(result).toContain(beforeTime.substring(0, 8));
  });

  // SAVE
  it('SAVE - 저장 확인', async () => {
    const result = await handler.execute(['SAVE']);
    expect(result).toContain('+OK');
  });

  // LASTSAVE
  it('LASTSAVE - 마지막 저장 시간 반환', async () => {
    const result = await handler.execute(['LASTSAVE']);
    expect(result).toContain(':0');
  });

  // SHUTDOWN
  it('SHUTDOWN - 응답 반환', async () => {
    const result = await handler.execute(['SHUTDOWN']);
    expect(result).toContain('+OK');
  });

  // COMMAND
  it('COMMAND COUNT - 명령어 수 반환', async () => {
    const result = await handler.execute(['COMMAND', 'COUNT']);
    expect(result).toMatch(/:\d+/);
    const count = parseInt(result.replace(/[^0-9]/g, ''));
    expect(count).toBeGreaterThan(0);
  });

  it('COMMAND LIST - 명령어 목록 반환', async () => {
    const result = await handler.execute(['COMMAND', 'LIST']);
    expect(result).toContain('*');
    expect(result).toContain('GET');
    expect(result).toContain('SET');
  });

  it('COMMAND INFO - 특정 명령어 정보 반환', async () => {
    const result = await handler.execute(['COMMAND', 'INFO', 'GET']);
    expect(result).toContain('GET');
  });

  it('COMMAND DOCS - 빈 배열 또는 기본 응답', async () => {
    const result = await handler.execute(['COMMAND', 'DOCS', 'GET']);
    expect(result).toBeDefined();
  });

  it('COMMAND GETKEYS - 키 추출', async () => {
    const result = await handler.execute(['COMMAND', 'GETKEYS', 'GET', 'mykey']);
    expect(result).toContain('mykey');
  });

  // CONFIG
  it('CONFIG GET save - 저장 설정 반환', async () => {
    const result = await handler.execute(['CONFIG', 'GET', 'save']);
    expect(result).toContain('save');
  });

  it('CONFIG GET appendonly - appendonly 설정 반환', async () => {
    const result = await handler.execute(['CONFIG', 'GET', 'appendonly']);
    expect(result).toContain('appendonly');
    expect(result).toContain('no');
  });

  it('CONFIG GET unknown - 빈 배열 반환', async () => {
    const result = await handler.execute(['CONFIG', 'GET', 'unknown_param']);
    expect(result).toContain('*0');
  });

  it('CONFIG SET appendonly yes - 설정 변경', async () => {
    const result = await handler.execute(['CONFIG', 'SET', 'appendonly', 'yes']);
    expect(result).toContain('+OK');
  });

  // SLOWLOG
  it('SLOWLOG GET - 슬로우로그 조회', async () => {
    const result = await handler.execute(['SLOWLOG', 'GET']);
    expect(result).toBeDefined();
  });

  it('SLOWLOG LEN - 슬로우로그 길이', async () => {
    const result = await handler.execute(['SLOWLOG', 'LEN']);
    expect(result).toContain(':');
  });

  it('SLOWLOG RESET - 슬로우로그 초기화', async () => {
    const result = await handler.execute(['SLOWLOG', 'RESET']);
    expect(result).toContain('+OK');
  });

  // MEMORY
  it('MEMORY USAGE - 메모리 사용량 추정', async () => {
    await handler.execute(['SET', 'mykey', 'hello world this is a test value']);
    const result = await handler.execute(['MEMORY', 'USAGE', 'mykey']);
    expect(result).toMatch(/:\d+/);
    const bytes = parseInt(result.replace(/[^0-9]/g, ''));
    expect(bytes).toBeGreaterThan(0);
  });

  it('MEMORY USAGE - 존재하지 않는 키', async () => {
    const result = await handler.execute(['MEMORY', 'USAGE', 'nonexistent']);
    expect(result).toBeDefined();
  });

  // LASTSAVE after SAVE (InMemoryStorage always returns 0)
  it('SAVE 후 LASTSAVE - InMemoryStorage는 항상 0', async () => {
    await handler.execute(['SAVE']);
    const result = await handler.execute(['LASTSAVE']);
    expect(result).toContain(':0');
  });
});

describe('SqliteStorage 서버 명령어', () => {
  let storage: SqliteStorage;
  let handler: CommandHandler;

  beforeEach(() => {
    storage = new SqliteStorage({ path: ':memory:' });
    const pubsub = new PubSubManager();
    handler = new CommandHandler(storage, pubsub, 'test-conn', () => {});
  });

  it('SAVE 후 LASTSAVE - 저장 시간 업데이트', async () => {
    const before = Math.floor(Date.now() / 1000);
    await handler.execute(['SAVE']);
    const result = await handler.execute(['LASTSAVE']);
    const lastSave = parseInt(result.replace(/[^0-9]/g, ''));
    expect(lastSave).toBeGreaterThanOrEqual(before);
  });

  it('INFO persistence - SQLite 저장 정보', async () => {
    await handler.execute(['SAVE']);
    const result = await handler.execute(['INFO', 'persistence']);
    expect(result).toContain('rdb_last_save_time');
  });
});
