import { describe, it, expect, beforeEach } from 'vitest';
import { PubSubManager } from '../pubsub/manager';

describe('PubSub 연결 해제 정리', () => {
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

  // 1. Basic disconnect cleanup — channel subscriptions
  it('연결 해제 후 채널 구독이 정리된다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    const count = pubsub.publish('news', 'hello');
    expect(count).toBe(0);
  });

  // 2. Basic disconnect cleanup — pattern subscriptions
  it('연결 해제 후 패턴 구독이 정리된다', () => {
    pubsub.psubscribe('conn1', ['news.*'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    const count = pubsub.publish('news.sports', 'score');
    expect(count).toBe(0);
  });

  // 3. Both channel and pattern subscriptions cleaned up on disconnect
  it('연결 해제 후 채널과 패턴 구독 모두 정리된다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.psubscribe('conn1', ['events.*'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.publish('news', 'hello')).toBe(0);
    expect(pubsub.publish('events.xyz', 'hello')).toBe(0);
  });

  // 4. hasSubscriptions returns false after disconnect
  it('hasSubscriptions — 연결 해제 후 false를 반환한다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    expect(pubsub.hasSubscriptions('conn1')).toBe(true);
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.hasSubscriptions('conn1')).toBe(false);
  });

  // 5. Other connections retain subscriptions when one disconnects
  it('한 연결이 해제되어도 다른 연결은 구독을 유지한다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.subscribe('conn2', ['news'], makeSend('conn2'));
    pubsub.unsubscribeAll('conn1');
    const count = pubsub.publish('news', 'hello');
    expect(count).toBe(1);
    // conn2 should still receive the message
    expect(received.has('conn2')).toBe(true);
    expect(received.get('conn2')!.length).toBeGreaterThan(0);
    // conn1 should NOT receive messages after disconnect
    expect(received.has('conn1')).toBe(false);
  });

  // 6. Channel removed when last subscriber disconnects
  it('마지막 구독자 연결 해제 시 채널이 제거된다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    expect(pubsub.getChannels()).toContain('news');
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.getChannels()).not.toContain('news');
  });

  // 7. All channels cleaned up after multi-channel subscriber disconnects
  it('여러 채널 구독 후 전체 해제 시 모든 채널이 정리된다', () => {
    pubsub.subscribe('conn1', ['news', 'sports', 'tech'], makeSend('conn1'));
    expect(pubsub.getChannels()).toHaveLength(3);
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.getChannels()).toHaveLength(0);
  });

  // 8. Pattern unsub cleanup — publish no longer matches
  it('패턴 구독 해제 후 publish가 매칭되지 않는다', () => {
    pubsub.psubscribe('conn1', ['user.*'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    const count = pubsub.publish('user.123', 'data');
    expect(count).toBe(0);
  });

  // 9. Channel list removes channels only subscribed by the disconnected connection
  it('연결 해제 후 getChannels에서 해당 채널이 제거된다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.subscribe('conn2', ['sports'], makeSend('conn2'));
    expect(pubsub.getChannels()).toContain('news');
    expect(pubsub.getChannels()).toContain('sports');
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.getChannels()).not.toContain('news');
    expect(pubsub.getChannels()).toContain('sports');
  });

  // 10. unsubscribeAll on nonexistent connection should not throw
  it('존재하지 않는 연결 ID로 unsubscribeAll을 호출해도 에러 없이 동작한다', () => {
    expect(() => pubsub.unsubscribeAll('nonexistent')).not.toThrow();
  });

  // 11. Calling unsubscribeAll twice on the same connection should not throw
  it('동일 연결에 여러 번 unsubscribeAll을 호출해도 에러 없이 동작한다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    expect(() => pubsub.unsubscribeAll('conn1')).not.toThrow();
  });

  // 12. getNumSub returns correct count after disconnect
  it('연결 해제 후 getNumSub가 올바른 수를 반환한다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.subscribe('conn2', ['news'], makeSend('conn2'));
    pubsub.unsubscribeAll('conn1');
    const result = pubsub.getNumSub(['news']);
    expect(result).toEqual([['news', 1]]);
  });

  // 13. getNumPat returns correct count after disconnect
  it('연결 해제 후 getNumPat이 올바른 수를 반환한다', () => {
    pubsub.psubscribe('conn1', ['news.*'], makeSend('conn1'));
    pubsub.psubscribe('conn2', ['sports.*'], makeSend('conn2'));
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.getNumPat()).toBe(1);
  });

  // 14. Combined channel + pattern subscription cleanup
  it('채널 구독과 패턴 구독이 모두 있는 연결의 해제', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.psubscribe('conn1', ['events.*'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.publish('news', 'msg')).toBe(0);
    expect(pubsub.publish('events.xyz', 'msg')).toBe(0);
  });

  // 15. Same channel with both channel and pattern subscription, then disconnect
  it('동일 채널에 대한 채널+패턴 구독 후 연결 해제', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.psubscribe('conn1', ['news*'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    expect(pubsub.publish('news', 'msg')).toBe(0);
    expect(pubsub.hasSubscriptions('conn1')).toBe(false);
  });

  // 16. Re-subscription after disconnect
  it('연결 해제 후 재구독이 가능하다', () => {
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    pubsub.unsubscribeAll('conn1');
    // Re-subscribe with the same connId
    received.clear();
    pubsub.subscribe('conn1', ['news'], makeSend('conn1'));
    const count = pubsub.publish('news', 'msg');
    expect(count).toBe(1);
    expect(received.has('conn1')).toBe(true);
    expect(received.get('conn1')!.length).toBe(1);
    expect(received.get('conn1')![0]).toContain('msg');
  });
});