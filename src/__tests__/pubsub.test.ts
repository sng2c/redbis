import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage/memory';
import { PubSubManager } from '../pubsub/manager';
import { CommandHandler } from '../command/handler';

let storage: InMemoryStorage;
let pubsub: PubSubManager;
let handler: CommandHandler;
let received: string[];

function createHandler(connId: string, collectReceived?: string[]): CommandHandler {
  const send = (msg: string) => {
    if (collectReceived) {
      collectReceived.push(msg);
    }
  };
  return new CommandHandler(storage, pubsub, connId, send);
}

describe('PubSubManager', () => {
  let pubsub: PubSubManager;
  let received: Map<string, string[]>;

  beforeEach(() => {
    pubsub = new PubSubManager();
    received = new Map();
  });

  const makeSend = (connId: string) => (msg: string) => {
    if (!received.has(connId)) received.set(connId, []);
    received.get(connId)!.push(msg);
  };

  it('채널 구독 및 구독 확인 응답', () => {
    const result = pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('subscribe');
    expect(result[0]).toContain('news');
  });

  it('다중 채널 구독', () => {
    const result = pubsub.subscribe('conn1', ['news', 'sports'], makeSend('conn1'));
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('news');
    expect(result[1]).toContain('sports');
  });

  it('메시지 발행 시 구독자에게 전달', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    const count = pubsub.publish('news', 'hello world');
    expect(count).toBe(1);
    expect(received.get('conn1')).toHaveLength(1);
    expect(received.get('conn1')![0]).toContain('message');
    expect(received.get('conn1')![0]).toContain('news');
    expect(received.get('conn1')![0]).toContain('hello world');
  });

  it('구독하지 않은 채널에 발행 시 수신자 0', () => {
    const count = pubsub.publish('news', 'hello');
    expect(count).toBe(0);
  });

  it('채널 구독 취소', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    const result = pubsub.unsubscribe('conn1', ['news']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('unsubscribe');
    expect(pubsub.publish('news', 'hello')).toBe(0);
  });

  it('모든 채널 구독 취소 (빈 배열)', () => {
    pubsub.subscribe('conn1', ['news', 'sports'], makeSend('conn1'));
    const result = pubsub.unsubscribe('conn1', []);
    expect(result).toHaveLength(2);
    expect(pubsub.publish('news', 'hello')).toBe(0);
    expect(pubsub.publish('sports', 'hello')).toBe(0);
  });

  it('패턴 구독 및 메시지 수신', () => {
    pubsub.psubscribe('conn1', ['news.*'], makeSend('conn1'));
    const count = pubsub.publish('news.sports', 'score');
    expect(count).toBe(1);
    expect(received.get('conn1')![0]).toContain('pmessage');
    expect(received.get('conn1')![0]).toContain('news.*');
    expect(received.get('conn1')![0]).toContain('news.sports');
    expect(received.get('conn1')![0]).toContain('score');
  });

  it('패턴 구독 취소', () => {
    pubsub.psubscribe('conn1', ['news.*'], makeSend('conn1'));
    pubsub.punsubscribe('conn1', ['news.*']);
    expect(pubsub.publish('news.sports', 'score')).toBe(0);
  });

  it('모든 패턴 구독 취소 (빈 배열)', () => {
    pubsub.psubscribe('conn1', ['news.*', 'sports.*'], makeSend('conn1'));
    const result = pubsub.punsubscribe('conn1', []);
    expect(result).toHaveLength(2);
  });

  it('채널 구독과 패턴 구독 모두 일치 시 한 연결은 한 번만 카운트', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.psubscribe('conn1', ['news*'], makeSend('conn1'));
    const count = pubsub.publish('news', 'hello');
    expect(count).toBe(1);
    expect(received.get('conn1')).toHaveLength(2);
  });

  it('여러 연결에 메시지 발행', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.subscribe('conn2', ['news'], makeSend('conn2'));
    const count = pubsub.publish('news', 'hello');
    expect(count).toBe(2);
  });

  it('getChannels - 활성 채널 목록', () => {
    pubsub.subscribe('conn1', ['news', 'sports'], makeSend('conn1'));
    const channels = pubsub.getChannels();
    expect(channels).toContain('news');
    expect(channels).toContain('sports');
  });

  it('getChannels - 패턴 필터', () => {
    pubsub.subscribe('conn1', ['news', 'sports'], makeSend('conn1'));
    const channels = pubsub.getChannels('n*');
    expect(channels).toContain('news');
    expect(channels).not.toContain('sports');
  });

  it('getNumSub - 채널별 구독자 수', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.subscribe('conn2', ['news'], makeSend('conn2'));
    pubsub.subscribe('conn1', ['sports'], makeSend('conn1'));
    const result = pubsub.getNumSub(['news', 'sports']);
    expect(result).toEqual([['news', 2], ['sports', 1]]);
  });

  it('getNumPat - 패턴 구독 수', () => {
    pubsub.psubscribe('conn1', ['news.*'], makeSend('conn1'));
    pubsub.psubscribe('conn2', ['sports.*'], makeSend('conn2'));
    expect(pubsub.getNumPat()).toBe(2);
  });

  it('unsubscribeAll - 연결 종료 시 모든 구독 제거', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.psubscribe('conn1', ['sports.*'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.publish('news', 'hello')).toBe(0);
    expect(pubsub.getNumPat()).toBe(0);
  });

  it('hasSubscriptions - 구독 여부 확인', () => {
    expect(pubsub.hasSubscriptions('conn1')).toBe(false);
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    expect(pubsub.hasSubscriptions('conn1')).toBe(true);
  });

  it('구독 없는 연결 unsubscribeAll - 에러 없이 동작', () => {
    expect(() => pubsub.unsubscribeAll('conn1')).not.toThrow();
  });

  it('구독 없는 채널 unsubscribe 응답', () => {
    const result = pubsub.unsubscribe('conn1', []);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('unsubscribe');
  });
});

describe('Pub/Sub 명령어', () => {
  beforeEach(() => {
    storage = new InMemoryStorage();
    pubsub = new PubSubManager();
    received = [];
    handler = new CommandHandler(storage, pubsub, 'test-conn', (msg: string) => {
      received.push(msg);
    });
  });

  it('PUBLISH - 구독자가 없으면 0 반환', async () => {
    const result = await handler.execute(['PUBLISH', 'news', 'hello']);
    expect(result).toContain(':0');
  });

  it('SUBSCRIBE - 채널 구독 응답', async () => {
    const result = await handler.execute(['SUBSCRIBE', 'news']);
    expect(result).toContain('subscribe');
    expect(result).toContain('news');
  });

  it('SUBSCRIBE 후 PUBLISH 시 수신', async () => {
    await handler.execute(['SUBSCRIBE', 'news']);
    const handler2 = new CommandHandler(storage, pubsub, 'conn2', () => {});
    const count = await handler2.execute(['PUBLISH', 'news', 'hello']);
    expect(count).toContain(':1');
    expect(received.length).toBeGreaterThan(0);
  });

  it('UNSUBSCRIBE - 구독 취소', async () => {
    await handler.execute(['SUBSCRIBE', 'news']);
    const result = await handler.execute(['UNSUBSCRIBE', 'news']);
    expect(result).toContain('unsubscribe');
  });

  it('PSUBSCRIBE - 패턴 구독', async () => {
    const result = await handler.execute(['PSUBSCRIBE', 'news.*']);
    expect(result).toContain('psubscribe');
  });

  it('PUNSUBSCRIBE - 패턴 구독 취소', async () => {
    await handler.execute(['PSUBSCRIBE', 'news.*']);
    const result = await handler.execute(['PUNSUBSCRIBE', 'news.*']);
    expect(result).toContain('punsubscribe');
  });

  it('PUBSUB CHANNELS', async () => {
    await handler.execute(['SUBSCRIBE', 'news']);
    const result = await handler.execute(['PUBSUB', 'CHANNELS']);
    expect(result).toContain('news');
  });

  it('PUBSUB NUMSUB', async () => {
    await handler.execute(['SUBSCRIBE', 'news']);
    const result = await handler.execute(['PUBSUB', 'NUMSUB', 'news']);
    expect(result).toContain('news');
  });

  it('PUBSUB NUMPAT', async () => {
    await handler.execute(['PSUBSCRIBE', 'news.*']);
    const result = await handler.execute(['PUBSUB', 'NUMPAT']);
    expect(result).toContain(':1');
  });

  it('SPUBLISH - 샤드 발행 (PUBLISH와 동일)', async () => {
    await handler.execute(['SUBSCRIBE', 'news']);
    const result = await handler.execute(['SPUBLISH', 'news', 'hello']);
    expect(result).toContain(':1');
  });

  it('SSUBSCRIBE - 샤드 구독 (SUBSCRIBE와 동일)', async () => {
    const result = await handler.execute(['SSUBSCRIBE', 'news']);
    expect(result).toContain('subscribe');
  });

  it('SUNSUBSCRIBE - 샤드 구독 취소', async () => {
    await handler.execute(['SSUBSCRIBE', 'news']);
    const result = await handler.execute(['SUNSUBSCRIBE', 'news']);
    expect(result).toContain('unsubscribe');
  });

  it('PUBSUB SHARDCHANNELS', async () => {
    await handler.execute(['SSUBSCRIBE', 'news']);
    const result = await handler.execute(['PUBSUB', 'SHARDCHANNELS']);
    expect(result).toContain('news');
  });

  it('PUBSUB SHARDNUMSUB', async () => {
    await handler.execute(['SSUBSCRIBE', 'news']);
    const result = await handler.execute(['PUBSUB', 'SHARDNUMSUB', 'news']);
    expect(result).toContain('news');
  });

  it('destroy - 연결 종료 시 구독 정리', async () => {
    await handler.execute(['SUBSCRIBE', 'news']);
    handler.destroy();
    const handler2 = new CommandHandler(storage, pubsub, 'conn2', () => {});
    const count = await handler2.execute(['PUBLISH', 'news', 'hello']);
    expect(count).toContain(':0');
  });
});