import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage/memory';

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  describe('get', () => {
    it('존재하지 않는 키는 null을 반환한다', async () => {
      const result = await storage.get('nonexistent');
      expect(result).toBeNull();
    });

    it('존재하는 키의 값을 반환한다', async () => {
      await storage.set('mykey', 'myvalue');
      const result = await storage.get('mykey');
      expect(result).toBe('myvalue');
    });
  });

  describe('set', () => {
    it('키-값 쌍을 저장한다', async () => {
      await storage.set('key', 'value');
      const result = await storage.get('key');
      expect(result).toBe('value');
    });

    it('기존 키의 값을 덮어쓴다', async () => {
      await storage.set('key', 'old');
      await storage.set('key', 'new');
      const result = await storage.get('key');
      expect(result).toBe('new');
    });

    it('여러 키-값 쌍을 저장할 수 있다', async () => {
      await storage.set('key1', 'val1');
      await storage.set('key2', 'val2');
      expect(await storage.get('key1')).toBe('val1');
      expect(await storage.get('key2')).toBe('val2');
    });
  });

  describe('delete', () => {
    it('존재하는 키를 삭제하고 true를 반환한다', async () => {
      await storage.set('key', 'value');
      const result = await storage.delete('key');
      expect(result).toBe(true);
      expect(await storage.get('key')).toBeNull();
    });

    it('존재하지 않는 키를 삭제하면 false를 반환한다', async () => {
      const result = await storage.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('keys', () => {
    it('와일드카드 패턴 * 으로 모든 키를 반환한다', async () => {
      await storage.set('key1', 'val1');
      await storage.set('key2', 'val2');
      const result = await storage.keys('*');
      expect(result.sort()).toEqual(['key1', 'key2']);
    });

    it('접두사 패턴으로 키를 반환한다', async () => {
      await storage.set('user:1', 'a');
      await storage.set('user:2', 'b');
      await storage.set('post:1', 'c');
      const result = await storage.keys('user:*');
      expect(result.sort()).toEqual(['user:1', 'user:2']);
    });

    it('물음표 패턴으로 키를 반환한다', async () => {
      await storage.set('abc', '1');
      await storage.set('adc', '2');
      await storage.set('aec', '3');
      await storage.set('abec', '4');
      const result = await storage.keys('a?c');
      expect(result.sort()).toEqual(['abc', 'adc', 'aec']);
    });

    it('매칭되는 키가 없으면 빈 배열을 반환한다', async () => {
      await storage.set('key1', 'val1');
      const result = await storage.keys('nomatch*');
      expect(result).toEqual([]);
    });

    it('빈 저장소에서 빈 배열을 반환한다', async () => {
      const result = await storage.keys('*');
      expect(result).toEqual([]);
    });
  });

  describe('flush', () => {
    it('모든 키를 삭제한다', async () => {
      await storage.set('key1', 'val1');
      await storage.set('key2', 'val2');
      await storage.flush();
      expect(await storage.get('key1')).toBeNull();
      expect(await storage.get('key2')).toBeNull();
    });

    it('flush 후 keys가 빈 배열을 반환한다', async () => {
      await storage.set('key1', 'val1');
      await storage.flush();
      const result = await storage.keys('*');
      expect(result).toEqual([]);
    });
  });

  describe('정규식 특수문자 키 set/get/delete', () => {
    it('정규식 특수문자가 포함된 키로 set/get이 정확히 동작한다', async () => {
      const specialKeys = [
        'key.with.dots',
        'key*star',
        'key?question',
        'key[bracket]',
        'key(paren)',
        'key{brace}',
        'key+plus',
        'key^caret',
        'key$dollar',
        'key|pipe',
        'key\\backslash',
      ];
      for (const key of specialKeys) {
        await storage.set(key, `value_of_${key}`);
      }
      for (const key of specialKeys) {
        const result = await storage.get(key);
        expect(result).toBe(`value_of_${key}`);
      }
    });

    it('정규식 특수문자가 포함된 키의 delete가 정확히 동작한다', async () => {
      await storage.set('key[1]', 'val1');
      await storage.set('key[2]', 'val2');
      await storage.set('other', 'val3');

      const deleted = await storage.delete('key[1]');
      expect(deleted).toBe(true);
      expect(await storage.get('key[1]')).toBeNull();
      // 다른 키는 영향을 받지 않는다
      expect(await storage.get('key[2]')).toBe('val2');
      expect(await storage.get('other')).toBe('val3');
    });
  });

  describe('정규식 특수문자 키 패턴 매칭', () => {
    it('점(.)이 포함된 패턴은 리터럴 점으로만 매칭한다', async () => {
      await storage.set('prefix.abc', 'val1');
      await storage.set('prefixXabc', 'val2');
      await storage.set('prefixYabc', 'val3');

      const result = await storage.keys('prefix.*');
      // InMemoryStorage의 globToRegex은 .을 리터럴로 이스케이프하므로
      // 점이 포함된 키만 매칭되어야 한다
      expect(result).toEqual(['prefix.abc']);
    });

    it('대괄표 패턴이 문자 클래스로 동작한다', async () => {
      await storage.set('testi', 'val1');
      await storage.set('testt', 'val2');
      await storage.set('test[item]', 'val3');

      // Redis KEYS semantics: test[item] is a character class matching 'i'
      const result = await storage.keys('test[item]');
      expect(result.sort()).toEqual(['testi', 'testt']);
    });

    it('이스케이프된 대괄호로 리터럴 매칭한다', async () => {
      await storage.set('test[item]', 'val1');
      await storage.set('testitem', 'val2');

      const result = await storage.keys('test\\[item\\]');
      expect(result).toEqual(['test[item]']);
    });
  });

  describe('빈 문자열 키 set/get/delete', () => {
    it('빈 문자열 키로 set/get이 동작한다', async () => {
      await storage.set('', 'empty_key_value');
      const result = await storage.get('');
      expect(result).toBe('empty_key_value');
    });

    it('빈 문자열 키를 delete할 수 있다', async () => {
      await storage.set('', 'empty_key_value');
      const deleted = await storage.delete('');
      expect(deleted).toBe(true);
      expect(await storage.get('')).toBeNull();
    });
  });

  describe('keys(*) 모든 키 반환', () => {
    it('keys(*)가 모든 키를 반환한다', async () => {
      await storage.set('alpha', '1');
      await storage.set('beta', '2');
      await storage.set('gamma', '3');
      const result = await storage.keys('*');
      expect(result.sort()).toEqual(['alpha', 'beta', 'gamma']);
    });
  });
});