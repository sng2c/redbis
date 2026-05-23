import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import { PubSubManager } from '../pubsub/manager';
import { CommandHandler } from '../command/handler';

const storageProviders = [
  { name: 'InMemoryStorage', create: () => new InMemoryStorage() },
  { name: 'SqliteStorage', create: () => new SqliteStorage({ path: ':memory:' }) },
];

for (const { name, create } of storageProviders) {
  describe(`BLPOP/BRPOP/BRPOPLPUSH/BLMOVE — ${name}`, () => {
    let handler: CommandHandler;

    beforeEach(() => {
      handler = new CommandHandler(create(), new PubSubManager(), 'test-conn', () => {});
    });

    // ========================================
    // BLPOP
    // ========================================
    describe('BLPOP', () => {
      it('BLPOP — 요소가 있으면 즉시 반환한다', async () => {
        await handler.execute(['RPUSH', 'mylist', 'a']);
        const result = await handler.execute(['BLPOP', 'mylist', '0']);
        expect(result).toContain('mylist');
        expect(result).toContain('a');
      });

      it('BLPOP — 여러 키 중 첫 번째 비어있지 않은 키에서 반환한다', async () => {
        await handler.execute(['RPUSH', 'list2', 'hello']);
        const result = await handler.execute(['BLPOP', 'list1', 'list2', '0']);
        expect(result).toContain('list2');
        expect(result).toContain('hello');
      });

      it('BLPOP — 모든 키가 비어있으면 null을 반환한다', async () => {
        const result = await handler.execute(['BLPOP', 'nokey1', 'nokey2', '0']);
        expect(result).toBe('*-1\r\n');
      });

      it('BLPOP — timeout 1로 비어있는 리스트에 null을 반환한다', async () => {
        const result = await handler.execute(['BLPOP', 'nokey', '1']);
        expect(result).toBe('*-1\r\n');
      });

      it('BLPOP — 만료된 키를 무시한다', async () => {
        await handler.execute(['SET', 'expiredkey', 'value']);
        await handler.execute(['PEXPIRE', 'expiredkey', '1']);
        // Wait for the key to expire
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await handler.execute(['BLPOP', 'expiredkey', '0']);
        expect(result).toBe('*-1\r\n');
      });

      it('BLPOP — 문자열 키에 호출하면 WRONGTYPE 에러를 반환한다', async () => {
        await handler.execute(['SET', 'mykey', 'value']);
        const result = await handler.execute(['BLPOP', 'mykey', '0']);
        expect(result).toContain('WRONGTYPE');
      });
    });

    // ========================================
    // BRPOP
    // ========================================
    describe('BRPOP', () => {
      it('BRPOP — 요소가 있으면 오른쪽에서 반환한다', async () => {
        await handler.execute(['RPUSH', 'mylist', 'a', 'b', 'c']);
        const result = await handler.execute(['BRPOP', 'mylist', '0']);
        expect(result).toContain('mylist');
        expect(result).toContain('c');
      });

      it('BRPOP — 여러 키 중 첫 번째 비어있지 않은 키에서 반환한다', async () => {
        await handler.execute(['RPUSH', 'list2', 'world']);
        const result = await handler.execute(['BRPOP', 'list1', 'list2', '0']);
        expect(result).toContain('list2');
        expect(result).toContain('world');
      });

      it('BRPOP — 비어있는 리스트에 null을 반환한다', async () => {
        const result = await handler.execute(['BRPOP', 'nokey', '0']);
        expect(result).toBe('*-1\r\n');
      });

      it('BRPOP — timeout 1로 비어있는 리스트에 null을 반환한다', async () => {
        const result = await handler.execute(['BRPOP', 'nokey', '1']);
        expect(result).toBe('*-1\r\n');
      });

      it('BRPOP — 문자열 키에 호출하면 WRONGTYPE 에러를 반환한다', async () => {
        await handler.execute(['SET', 'mykey', 'value']);
        const result = await handler.execute(['BRPOP', 'mykey', '0']);
        expect(result).toContain('WRONGTYPE');
      });
    });

    // ========================================
    // BRPOPLPUSH
    // ========================================
    describe('BRPOPLPUSH', () => {
      it('BRPOPLPUSH — 소스가 비어있지 않으면 오른쪽 팝/왼쪽 푸시', async () => {
        await handler.execute(['RPUSH', 'src', 'a', 'b', 'c']);
        const result = await handler.execute(['BRPOPLPUSH', 'src', 'dst', '0']);
        expect(result).toBe('$1\r\nc\r\n');
        const dstResult = await handler.execute(['LRANGE', 'dst', '0', '-1']);
        expect(dstResult).toContain('c');
      });

      it('BRPOPLPUSH — 소스가 비어있으면 null을 반환한다', async () => {
        const result = await handler.execute(['BRPOPLPUSH', 'src', 'dst', '0']);
        expect(result).toBe('$-1\r\n');
      });

      it('BRPOPLPUSH — timeout 1로 빈 소스에 null을 반환한다', async () => {
        const result = await handler.execute(['BRPOPLPUSH', 'src', 'dst', '1']);
        expect(result).toBe('$-1\r\n');
      });
    });

    // ========================================
    // BLMOVE
    // ========================================
    describe('BLMOVE', () => {
      it('BLMOVE — LEFT LEFT로 이동한다', async () => {
        await handler.execute(['RPUSH', 'src', 'a', 'b', 'c']);
        const result = await handler.execute(['BLMOVE', 'src', 'dst', 'LEFT', 'LEFT', '0']);
        expect(result).toBe('$1\r\na\r\n');
        const dstResult = await handler.execute(['LRANGE', 'dst', '0', '-1']);
        expect(dstResult).toContain('a');
      });

      it('BLMOVE — RIGHT LEFT로 이동한다', async () => {
        await handler.execute(['RPUSH', 'src', 'a', 'b', 'c']);
        const result = await handler.execute(['BLMOVE', 'src', 'dst', 'RIGHT', 'LEFT', '0']);
        expect(result).toBe('$1\r\nc\r\n');
        const dstResult = await handler.execute(['LRANGE', 'dst', '0', '-1']);
        expect(dstResult).toContain('c');
      });

      it('BLMOVE — 소스가 비어있으면 null을 반환한다', async () => {
        const result = await handler.execute(['BLMOVE', 'src', 'dst', 'LEFT', 'LEFT', '0']);
        expect(result).toBe('$-1\r\n');
      });
    });
  });
}