import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage/memory';
import { PubSubManager } from '../pubsub/manager';
import { CommandHandler } from '../command/handler';

describe('트랜잭션 명령어', () => {
  let storage: InMemoryStorage;
  let pubsub: PubSubManager;
  let handler: CommandHandler;

  beforeEach(() => {
    storage = new InMemoryStorage();
    pubsub = new PubSubManager();
    handler = new CommandHandler(storage, pubsub, 'test-conn', () => {});
  });

  it('MULTI - 트랜잭션 시작', async () => {
    const result = await handler.execute(['MULTI']);
    expect(result).toContain('+OK');
  });

  it('MULTI 중첩 시 에러', async () => {
    await handler.execute(['MULTI']);
    const result = await handler.execute(['MULTI']);
    expect(result).toContain('MULTI calls can not be nested');
  });

  it('EXEC 없이 MULTI 시 큐에 명령어 저장', async () => {
    await handler.execute(['MULTI']);
    const result = await handler.execute(['SET', 'key1', 'value1']);
    expect(result).toContain('+QUEUED');
  });

  it('EXEC - 큐에 있는 명령어 실행', async () => {
    await handler.execute(['MULTI']);
    await handler.execute(['SET', 'key1', 'value1']);
    await handler.execute(['SET', 'key2', 'value2']);
    const result = await handler.execute(['EXEC']);
    expect(result).toContain('*2');
    const get1 = await handler.execute(['GET', 'key1']);
    expect(get1).toContain('value1');
    const get2 = await handler.execute(['GET', 'key2']);
    expect(get2).toContain('value2');
  });

  it('EXEC 없이 DISCARD - 에러', async () => {
    const result = await handler.execute(['DISCARD']);
    expect(result).toContain('DISCARD without MULTI');
  });

  it('DISCARD - 큐 비우기', async () => {
    await handler.execute(['MULTI']);
    await handler.execute(['SET', 'key1', 'value1']);
    const result = await handler.execute(['DISCARD']);
    expect(result).toContain('+OK');
    const get = await handler.execute(['GET', 'key1']);
    expect(get).toContain('$-1');
  });

  it('EXEC 후 새 트랜잭션 시작 가능', async () => {
    await handler.execute(['MULTI']);
    await handler.execute(['SET', 'key1', 'v1']);
    await handler.execute(['EXEC']);
    const result = await handler.execute(['MULTI']);
    expect(result).toContain('+OK');
  });

  it('EXEC 없이 직접 호출 시 에러', async () => {
    const result = await handler.execute(['EXEC']);
    expect(result).toContain('EXEC without MULTI');
  });

  it('트랜잭션 중 에러 발생 시 나머지 명령어 계속 실행', async () => {
    await handler.execute(['MULTI']);
    await handler.execute(['SET', 'key1', 'value1']);
    await handler.execute(['INVALIDCMD', 'arg1']);
    await handler.execute(['SET', 'key2', 'value2']);
    const result = await handler.execute(['EXEC']);
    expect(result).toContain('*3');
    // key2 should still be set despite the error on INVALIDCMD
    const get2 = await handler.execute(['GET', 'key2']);
    expect(get2).toContain('value2');
  });

  it('트랜잭션 내 GET 명령어 결과', async () => {
    await handler.execute(['SET', 'existing', 'data']);
    await handler.execute(['MULTI']);
    await handler.execute(['GET', 'existing']);
    const result = await handler.execute(['EXEC']);
    expect(result).toContain('data');
  });

  it('트랜잭션 내 여러 명령어 큐잉', async () => {
    await handler.execute(['MULTI']);
    const r1 = await handler.execute(['SET', 'a', '1']);
    const r2 = await handler.execute(['SET', 'b', '2']);
    const r3 = await handler.execute(['SET', 'c', '3']);
    expect(r1).toContain('+QUEUED');
    expect(r2).toContain('+QUEUED');
    expect(r3).toContain('+QUEUED');
    const execResult = await handler.execute(['EXEC']);
    expect(execResult).toContain('*3');
  });

  it('DISCARD 후 EXEC 호출 시 에러', async () => {
    await handler.execute(['MULTI']);
    await handler.execute(['SET', 'key1', 'value1']);
    await handler.execute(['DISCARD']);
    const result = await handler.execute(['EXEC']);
    expect(result).toContain('EXEC without MULTI');
  });

  it('트랜잭션 내 HASH 명령어', async () => {
    await handler.execute(['MULTI']);
    await handler.execute(['HSET', 'myhash', 'field1', 'value1']);
    await handler.execute(['HGET', 'myhash', 'field1']);
    const result = await handler.execute(['EXEC']);
    expect(result).toContain('value1');
  });

  it('트랜잭션 내 잘못된 인자 에러 기록', async () => {
    await handler.execute(['MULTI']);
    await handler.execute(['SET', 'key1', 'value1']);
    await handler.execute(['SET']);
    await handler.execute(['SET', 'key2', 'value2']);
    const result = await handler.execute(['EXEC']);
    const get2 = await handler.execute(['GET', 'key2']);
    expect(get2).toContain('value2');
  });
});
