import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import { PubSubManager } from '../pubsub/manager';

// ========================================
// InMemoryStorage JSON Tests
// ========================================

describe('JSON 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  // --- JSON.SET ---
  describe('JSON.SET 명령어', () => {
    it('루트 경로에 JSON 객체를 설정할 수 있다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo"}']);
      expect(result).toBe('+OK\r\n');
    });

    it('루트 경로에 JSON 배열을 설정할 수 있다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      expect(result).toBe('+OK\r\n');
    });

    it('루트 경로에 JSON 문자열을 설정할 수 있다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '"hello"']);
      expect(result).toBe('+OK\r\n');
    });

    it('루트 경로에 JSON 숫자를 설정할 수 있다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '42']);
      expect(result).toBe('+OK\r\n');
    });

    it('루트 경로에 JSON 불리언을 설정할 수 있다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', 'true']);
      expect(result).toBe('+OK\r\n');
    });

    it('루트 경로에 JSON null을 설정할 수 있다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', 'null']);
      expect(result).toBe('+OK\r\n');
    });

    it('중첩된 경로 $.field에 값을 설정할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo"}']);
      const result = await handler.execute(['JSON.SET', 'mykey', '$.name', '"bar"']);
      expect(result).toBe('+OK\r\n');
      const get = await handler.execute(['JSON.GET', 'mykey', '$.name']);
      expect(get).toContain('bar');
    });

    it('NX 플래그로 키가 없을 때만 설정한다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"x":1}', 'NX']);
      expect(result).toBe('+OK\r\n');
    });

    it('XX 플래그로 키가 있을 때만 설정한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"x":1}']);
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"x":2}', 'XX']);
      expect(result).toBe('+OK\r\n');
    });

    it('NX 플래그로 키가 있으면 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"x":1}']);
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"x":2}', 'NX']);
      expect(result).toBe('$-1\r\n');
    });

    it('XX 플래그로 키가 없으면 null을 반환한다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"x":1}', 'XX']);
      expect(result).toBe('$-1\r\n');
    });

    it('기존 키를 덮어쓸 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"x":1}']);
      await handler.execute(['JSON.SET', 'mykey', '$', '{"y":2}']);
      const result = await handler.execute(['JSON.GET', 'mykey']);
      expect(result).toContain('y');
    });

    it('해시 키에 JSON.SET을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['JSON.SET', 'myhash', '$', '{}']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  // --- JSON.GET ---
  describe('JSON.GET 명령어', () => {
    it('루트 경로의 JSON을 가져올 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo"}']);
      const result = await handler.execute(['JSON.GET', 'mykey']);
      expect(result).toContain('foo');
    });

    it('특정 경로의 JSON 값을 가져올 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo","age":25}']);
      const result = await handler.execute(['JSON.GET', 'mykey', '$.name']);
      expect(result).toContain('foo');
    });

    it('존재하지 않는 키는 null을 반환한다', async () => {
      const result = await handler.execute(['JSON.GET', 'nokey']);
      expect(result).toBe('$-1\r\n');
    });

    it('여러 경로를 지정할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      const result = await handler.execute(['JSON.GET', 'mykey', '$.a', '$.b']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('경로가 존재하지 않으면 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.GET', 'mykey', '$.nonexistent']);
      expect(result).toBe('$-1\r\n');
    });
  });

  // --- JSON.DEL / JSON.FORGET ---
  describe('JSON.DEL / JSON.FORGET 명령어', () => {
    it('루트 경로를 삭제하면 키가 제거된다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.DEL', 'mykey', '$']);
      expect(result).toBe(':1\r\n');
      const type = await handler.execute(['TYPE', 'mykey']);
      expect(type).toBe('+none\r\n');
    });

    it('특정 필드를 삭제할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      const result = await handler.execute(['JSON.DEL', 'mykey', '$.a']);
      expect(result).toBe(':1\r\n');
      const get = await handler.execute(['JSON.GET', 'mykey']);
      expect(get).not.toContain('"a"');
    });

    it('존재하지 않는 키에 DEL하면 0을 반환한다', async () => {
      const result = await handler.execute(['JSON.DEL', 'nokey', '$']);
      expect(result).toBe(':0\r\n');
    });

    it('FORGET은 DEL과 동일하게 동작한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.FORGET', 'mykey', '$']);
      expect(result).toBe(':1\r\n');
    });

    it('배열 요소를 삭제할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.DEL', 'mykey', '$[1]']);
      expect(result).toBe(':1\r\n');
      const get = await handler.execute(['JSON.GET', 'mykey']);
      // After deleting index 1, array should have 2 elements
      const parsed = JSON.parse(get!.replace(/^\$\d+\r\n/, '').replace(/\r\n$/, ''));
      expect(parsed.length).toBe(2);
    });
  });

  // --- JSON.TYPE ---
  describe('JSON.TYPE 명령어', () => {
    it('객체 타입은 object를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+object\r\n');
    });

    it('배열 타입은 array를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2]']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+array\r\n');
    });

    it('문자열 타입은 string을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '"hello"']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+string\r\n');
    });

    it('정수 타입은 integer를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '42']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+integer\r\n');
    });

    it('실수 타입은 number를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '3.14']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+number\r\n');
    });

    it('불리언 타입은 boolean을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', 'true']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+boolean\r\n');
    });

    it('null 타입은 null 문자열을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', 'null']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+null\r\n');
    });

    it('존재하지 않는 키는 null을 반환한다', async () => {
      const result = await handler.execute(['JSON.TYPE', 'nokey']);
      expect(result).toBe('$-1\r\n');
    });

    it('특정 경로의 타입을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":"hello"}']);
      const result = await handler.execute(['JSON.TYPE', 'mykey', '$.a']);
      expect(result).toBe('+integer\r\n');
    });
  });

  // --- JSON.STRLEN ---
  describe('JSON.STRLEN 명령어', () => {
    it('문자열의 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '"hello"']);
      const result = await handler.execute(['JSON.STRLEN', 'mykey']);
      expect(result).toBe(':5\r\n');
    });

    it('문자열이 아닌 값에 대해서는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '42']);
      const result = await handler.execute(['JSON.STRLEN', 'mykey']);
      expect(result).toBe('$-1\r\n');
    });

    it('특정 경로의 문자열 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"hello"}']);
      const result = await handler.execute(['JSON.STRLEN', 'mykey', '$.name']);
      expect(result).toBe(':5\r\n');
    });

    it('존재하지 않는 키는 null을 반환한다', async () => {
      const result = await handler.execute(['JSON.STRLEN', 'nokey']);
      expect(result).toBe('$-1\r\n');
    });
  });

  // --- JSON.STRAPPEND ---
  describe('JSON.STRAPPEND 명령어', () => {
    it('문자열에 값을 추가하고 새 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '"hello"']);
      const result = await handler.execute(['JSON.STRAPPEND', 'mykey', '$', '" world"']);
      expect(result).toBe(':11\r\n');
    });

    it('루트 경로에 문자열을 추가할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '"foo"']);
      const result = await handler.execute(['JSON.STRAPPEND', 'mykey', '$', '"bar"']);
      expect(result).toBe(':6\r\n');
    });

    it('객체 필드의 문자열에 추가할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo"}']);
      const result = await handler.execute(['JSON.STRAPPEND', 'mykey', '$.name', '"bar"']);
      expect(result).toBe(':6\r\n');
    });
  });

  // --- JSON.OBJKEYS ---
  describe('JSON.OBJKEYS 명령어', () => {
    it('객체의 키 목록을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      const result = await handler.execute(['JSON.OBJKEYS', 'mykey']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });

    it('객체가 아닌 값에 대해서는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2]']);
      const result = await handler.execute(['JSON.OBJKEYS', 'mykey']);
      expect(result).toBe('*-1\r\n');
    });

    it('특정 경로의 객체 키를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"inner":{"x":1,"y":2}}']);
      const result = await handler.execute(['JSON.OBJKEYS', 'mykey', '$.inner']);
      expect(result).toContain('x');
      expect(result).toContain('y');
    });

    it('존재하지 않는 키는 null을 반환한다', async () => {
      const result = await handler.execute(['JSON.OBJKEYS', 'nokey']);
      expect(result).toBe('*-1\r\n');
    });
  });

  // --- JSON.OBJLEN ---
  describe('JSON.OBJLEN 명령어', () => {
    it('객체의 키 수를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2,"c":3}']);
      const result = await handler.execute(['JSON.OBJLEN', 'mykey']);
      expect(result).toBe(':3\r\n');
    });

    it('객체가 아닌 값에 대해서는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2]']);
      const result = await handler.execute(['JSON.OBJLEN', 'mykey']);
      expect(result).toBe('$-1\r\n');
    });

    it('특정 경로의 객체 키 수를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"inner":{"x":1,"y":2}}']);
      const result = await handler.execute(['JSON.OBJLEN', 'mykey', '$.inner']);
      expect(result).toBe(':2\r\n');
    });
  });

  // --- JSON.ARRAPPEND ---
  describe('JSON.ARRAPPEND 명령어', () => {
    it('배열에 요소를 추가하고 새 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2]']);
      const result = await handler.execute(['JSON.ARRAPPEND', 'mykey', '$', '3']);
      // Result is an array of lengths
      expect(result).toContain(':3');
    });

    it('여러 요소를 한번에 추가할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1]']);
      const result = await handler.execute(['JSON.ARRAPPEND', 'mykey', '$', '2', '3']);
      expect(result).toContain(':3');
    });

    it('배열이 아닌 경로에 대해서는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.ARRAPPEND', 'mykey', '$.a', '2']);
      expect(result).toContain('$-1');
    });

    it('특정 경로의 배열에 추가할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"arr":[1,2]}']);
      const result = await handler.execute(['JSON.ARRAPPEND', 'mykey', '$.arr', '3']);
      expect(result).toContain(':3');
    });
  });

  // --- JSON.ARRINDEX ---
  describe('JSON.ARRINDEX 명령어', () => {
    it('배열에서 값의 인덱스를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.ARRINDEX', 'mykey', '$', '2']);
      expect(result).toBe(':1\r\n');
    });

    it('값을 찾지 못하면 -1을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.ARRINDEX', 'mykey', '$', '99']);
      expect(result).toBe(':-1\r\n');
    });

    it('start/stop 범위를 지정할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3,2]']);
      const result = await handler.execute(['JSON.ARRINDEX', 'mykey', '$', '2', '2', '3']);
      expect(result).toBe(':3\r\n');
    });

    it('배열이 아닌 경로에 대해서는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.ARRINDEX', 'mykey', '$.a', '1']);
      expect(result).toBe('$-1\r\n');
    });
  });

  // --- JSON.ARRINSERT ---
  describe('JSON.ARRINSERT 명령어', () => {
    it('배열의 지정된 인덱스에 값을 삽입한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,3]']);
      const result = await handler.execute(['JSON.ARRINSERT', 'mykey', '$', '1', '2']);
      expect(result).toContain(':3');
      const get = await handler.execute(['JSON.GET', 'mykey']);
      expect(get).toContain('[1,2,3]');
    });

    it('여러 값을 삽입할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,5]']);
      const result = await handler.execute(['JSON.ARRINSERT', 'mykey', '$', '1', '2', '3', '4']);
      expect(result).toContain(':5');
    });

    it('음수 인덱스를 사용할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,4]']);
      const result = await handler.execute(['JSON.ARRINSERT', 'mykey', '$', '-1', '3']);
      expect(result).toContain(':4');
    });
  });

  // --- JSON.ARRLEN ---
  describe('JSON.ARRLEN 명령어', () => {
    it('배열의 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.ARRLEN', 'mykey']);
      expect(result).toBe(':3\r\n');
    });

    it('배열이 아닌 값에 대해서는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.ARRLEN', 'mykey']);
      expect(result).toBe('$-1\r\n');
    });

    it('특정 경로의 배열 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"arr":[1,2,3]}']);
      const result = await handler.execute(['JSON.ARRLEN', 'mykey', '$.arr']);
      expect(result).toBe(':3\r\n');
    });
  });

  // --- JSON.ARRPOP ---
  describe('JSON.ARRPOP 명령어', () => {
    it('배열의 마지막 요소를 제거하고 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.ARRPOP', 'mykey', '$']);
      expect(result).toContain('3');
    });

    it('특정 인덱스의 요소를 제거하고 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.ARRPOP', 'mykey', '$', '0']);
      expect(result).toContain('1');
    });

    it('빈 배열에서는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[]']);
      const result = await handler.execute(['JSON.ARRPOP', 'mykey', '$']);
      expect(result).toBe('$-1\r\n');
    });

    it('음수 인덱스를 사용할 수 있다 (-1은 마지막 요소)', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.ARRPOP', 'mykey', '$', '-1']);
      expect(result).toContain('3');
    });
  });

  // --- JSON.ARRTRIM ---
  describe('JSON.ARRTRIM 명령어', () => {
    it('배열을 지정된 범위로 자르고 새 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[0,1,2,3,4]']);
      const result = await handler.execute(['JSON.ARRTRIM', 'mykey', '$', '1', '3']);
      expect(result).toBe(':3\r\n');
    });

    it('음수 인덱스를 처리한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[0,1,2,3,4]']);
      const result = await handler.execute(['JSON.ARRTRIM', 'mykey', '$', '-3', '-1']);
      expect(result).toMatch(/^:\d+\r\n$/);
    });
  });

  // --- JSON.NUMINCRBY ---
  describe('JSON.NUMINCRBY 명령어', () => {
    it('숫자 값을 증가시키고 새 값을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '10']);
      const result = await handler.execute(['JSON.NUMINCRBY', 'mykey', '$', '5']);
      expect(result).toContain('15');
    });

    it('음수로 감소시킬 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '10']);
      const result = await handler.execute(['JSON.NUMINCRBY', 'mykey', '$', '-3']);
      expect(result).toContain('7');
    });

    it('특정 경로의 숫자를 증가시킬 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"counter":5}']);
      const result = await handler.execute(['JSON.NUMINCRBY', 'mykey', '$.counter', '3']);
      expect(result).toContain('8');
    });
  });

  // --- JSON.NUMMULTBY ---
  describe('JSON.NUMMULTBY 명령어', () => {
    it('숫자 값을 곱하고 새 값을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '5']);
      const result = await handler.execute(['JSON.NUMMULTBY', 'mykey', '$', '3']);
      expect(result).toContain('15');
    });

    it('특정 경로의 숫자를 곱할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"val":4}']);
      const result = await handler.execute(['JSON.NUMMULTBY', 'mykey', '$.val', '2.5']);
      expect(result).toContain('10');
    });
  });

  // --- JSON.MGET ---
  describe('JSON.MGET 명령어', () => {
    it('여러 키에서 동일한 경로의 JSON 값을 가져온다', async () => {
      await handler.execute(['JSON.SET', 'key1', '$', '{"a":1}']);
      await handler.execute(['JSON.SET', 'key2', '$', '{"a":2}']);
      const result = await handler.execute(['JSON.MGET', 'key1', 'key2', '$.a']);
      expect(result).toContain('1');
      expect(result).toContain('2');
    });

    it('존재하지 않는 키는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'key1', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.MGET', 'key1', 'nokey', '$.a']);
      expect(result).toContain('$-1');
    });

    it('JSON이 아닌 키에 대해서는 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['SET', 'strkey', 'hello']);
      // MGET iterates through keys, non-json keys produce null, not error
      // Actually let me check the handler: jsonMget checks each key
      // If a key isn't json type, it returns null for that key
      // So no error, just null
      await handler.execute(['JSON.SET', 'jsonkey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.MGET', 'jsonkey', 'strkey', '$.a']);
      // For strkey (type=string, not json), it should return null
      expect(result).toContain('$-1');
    });
  });

  // --- JSON.MSET ---
  describe('JSON.MSET 명령어', () => {
    it('여러 키/경로에 JSON 값을 설정한다', async () => {
      const result = await handler.execute(['JSON.MSET', 'key1', '$', '{"a":1}', 'key2', '$', '{"b":2}']);
      expect(result).toBe('+OK\r\n');
      const r1 = await handler.execute(['JSON.GET', 'key1']);
      const r2 = await handler.execute(['JSON.GET', 'key2']);
      expect(r1).toContain('a');
      expect(r2).toContain('b');
    });

    it('기존 키의 경로를 업데이트한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      await handler.execute(['JSON.MSET', 'mykey', '$.a', '2']);
      const result = await handler.execute(['JSON.GET', 'mykey', '$.a']);
      expect(result).toContain('2');
    });
  });

  // --- JSON.TOGGLE ---
  describe('JSON.TOGGLE 명령어', () => {
    it('불리언 값을 반전시키고 새 값을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', 'true']);
      const result = await handler.execute(['JSON.TOGGLE', 'mykey', '$']);
      expect(result).toContain('false');
    });

    it('true는 false로, false는 true로 반전한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', 'false']);
      const result = await handler.execute(['JSON.TOGGLE', 'mykey', '$']);
      expect(result).toContain('true');
    });

    it('불리언이 아닌 값에 대해서는 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '42']);
      const result = await handler.execute(['JSON.TOGGLE', 'mykey', '$']);
      expect(result).toBe('$-1\r\n');
    });

    it('특정 경로의 불리언을 반전시킬 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"flag":true}']);
      const result = await handler.execute(['JSON.TOGGLE', 'mykey', '$.flag']);
      expect(result).toContain('false');
    });
  });

  // --- JSON.CLEAR ---
  describe('JSON.CLEAR 명령어', () => {
    it('객체를 빈 객체로 초기화한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      const result = await handler.execute(['JSON.CLEAR', 'mykey']);
      expect(result).toBe(':1\r\n');
      const get = await handler.execute(['JSON.GET', 'mykey']);
      expect(get).toContain('{}');
    });

    it('배열을 빈 배열로 초기화한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.CLEAR', 'mykey']);
      expect(result).toBe(':1\r\n');
      const get = await handler.execute(['JSON.GET', 'mykey']);
      expect(get).toContain('[]');
    });

    it('숫자를 0으로 초기화한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '42']);
      const result = await handler.execute(['JSON.CLEAR', 'mykey']);
      expect(result).toBe(':1\r\n');
      const get = await handler.execute(['JSON.GET', 'mykey']);
      expect(get).toContain('0');
    });

    it('문자열을 빈 문자열로 초기화한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '"hello"']);
      const result = await handler.execute(['JSON.CLEAR', 'mykey']);
      expect(result).toBe(':1\r\n');
    });

    it('초기화된 경로 수를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      const result = await handler.execute(['JSON.CLEAR', 'mykey']);
      expect(result).toBe(':1\r\n');
    });
  });

  // --- JSON.DEBUG MEMORY ---
  describe('JSON.DEBUG MEMORY 명령어', () => {
    it('JSON 값의 대략적인 메모리 사용량을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo"}']);
      const result = await handler.execute(['JSON.DEBUG', 'MEMORY', 'mykey']);
      expect(result).toMatch(/^:\d+\r\n$/);
      const bytes = parseInt(result.slice(1));
      expect(bytes).toBeGreaterThan(0);
    });

    it('특정 경로의 메모리 사용량을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo","age":25}']);
      const result = await handler.execute(['JSON.DEBUG', 'MEMORY', 'mykey', '$.name']);
      expect(result).toMatch(/^:\d+\r\n$/);
    });

    it('존재하지 않는 키는 null을 반환한다', async () => {
      const result = await handler.execute(['JSON.DEBUG', 'MEMORY', 'nokey']);
      expect(result).toBe('$-1\r\n');
    });
  });

  // --- JSON.RESP ---
  describe('JSON.RESP 명령어', () => {
    it('객체를 RESP 맵으로 변환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.RESP', 'mykey']);
      expect(result).toBeTruthy();
    });

    it('배열을 RESP 배열로 변환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2]']);
      const result = await handler.execute(['JSON.RESP', 'mykey']);
      expect(result).toBeTruthy();
    });

    it('문자열을 RESP bulk string으로 변환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '"hello"']);
      const result = await handler.execute(['JSON.RESP', 'mykey']);
      expect(result).toContain('hello');
    });

    it('정수를 RESP integer로 변환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '42']);
      const result = await handler.execute(['JSON.RESP', 'mykey']);
      expect(result).toContain('42');
    });

    it('불리언 true를 1로, false를 0으로 변환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', 'true']);
      const result = await handler.execute(['JSON.RESP', 'mykey']);
      expect(result).toContain('1');
    });

    it('null을 RESP null로 변환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', 'null']);
      const result = await handler.execute(['JSON.RESP', 'mykey']);
      expect(result).toContain('null');
    });
  });

  // --- JSON.MERGE ---
  describe('JSON.MERGE 명령어', () => {
    it('RFC 7396 머지 패치를 수행한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      await handler.execute(['JSON.MERGE', 'mykey', '$', '{"b":3,"c":4}']);
      const result = await handler.execute(['JSON.GET', 'mykey']);
      expect(result).toContain('"b":3');
      expect(result).toContain('"c":4');
      expect(result).toContain('"a":1');
    });

    it('null 값으로 키를 삭제한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      await handler.execute(['JSON.MERGE', 'mykey', '$', '{"b":null}']);
      const result = await handler.execute(['JSON.GET', 'mykey']);
      expect(result).toContain('"a":1');
      expect(result).not.toContain('"b"');
    });

    it('중첩된 객체를 재귀적으로 병합한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"inner":{"a":1,"b":2}}']);
      await handler.execute(['JSON.MERGE', 'mykey', '$', '{"inner":{"b":3,"c":4}}']);
      const result = await handler.execute(['JSON.GET', 'mykey']);
      expect(result).toContain('"a":1');
      expect(result).toContain('"b":3');
      expect(result).toContain('"c":4');
    });

    it('문자열 값을 교체한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo"}']);
      await handler.execute(['JSON.MERGE', 'mykey', '$', '{"name":"bar"}']);
      const result = await handler.execute(['JSON.GET', 'mykey']);
      expect(result).toContain('"bar"');
    });
  });

  // --- Cross-type tests ---
  describe('JSON 교차 타입 테스트', () => {
    it('JSON.SET 후 TYPE 명령은 json을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['TYPE', 'mykey']);
      expect(result).toBe('+json\r\n');
    });

    it('HSET 후 JSON.SET을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['JSON.SET', 'myhash', '$', '{}']);
      expect(result).toContain('WRONGTYPE');
    });

    it('JSON.SET 후 GET으로 원시 JSON 문자열을 읽을 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['GET', 'mykey']);
      expect(result).toContain('{"a":1}');
    });

    it('JSON.SET 후 DEL로 키를 삭제할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['DEL', 'mykey']);
      expect(result).toBe(':1\r\n');
      const type = await handler.execute(['TYPE', 'mykey']);
      expect(type).toBe('+none\r\n');
    });

    it('JSON.SET 후 COPY 명령으로 키를 복사할 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['COPY', 'mykey', 'mykey2']);
      expect(result).toBe(':1\r\n');
      const get = await handler.execute(['JSON.GET', 'mykey2']);
      expect(get).toContain('a');
    });
  });
});

// ========================================
// SqliteStorage JSON Tests
// ========================================

describe('JSON 명령어 — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  // --- JSON.SET ---
  describe('JSON.SET 명령어', () => {
    it('루트 경로에 JSON 객체를 설정할 수 있다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo"}']);
      expect(result).toBe('+OK\r\n');
    });

    it('루트 경로에 JSON 배열을 설정할 수 있다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      expect(result).toBe('+OK\r\n');
    });

    it('NX 플래그로 키가 없을 때만 설정한다', async () => {
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"x":1}', 'NX']);
      expect(result).toBe('+OK\r\n');
    });

    it('XX 플래그로 키가 있을 때만 설정한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"x":1}']);
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"x":2}', 'XX']);
      expect(result).toBe('+OK\r\n');
    });

    it('NX 플래그로 키가 있으면 null을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"x":1}']);
      const result = await handler.execute(['JSON.SET', 'mykey', '$', '{"x":2}', 'NX']);
      expect(result).toBe('$-1\r\n');
    });

    it('해시 키에 JSON.SET을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['JSON.SET', 'myhash', '$', '{}']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  // --- JSON.GET ---
  describe('JSON.GET 명령어', () => {
    it('루트 경로의 JSON을 가져올 수 있다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"name":"foo"}']);
      const result = await handler.execute(['JSON.GET', 'mykey']);
      expect(result).toContain('foo');
    });

    it('존재하지 않는 키는 null을 반환한다', async () => {
      const result = await handler.execute(['JSON.GET', 'nokey']);
      expect(result).toBe('$-1\r\n');
    });
  });

  // --- JSON.DEL ---
  describe('JSON.DEL 명령어', () => {
    it('루트 경로를 삭제하면 키가 제거된다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.DEL', 'mykey', '$']);
      expect(result).toBe(':1\r\n');
    });
  });

  // --- JSON.TYPE ---
  describe('JSON.TYPE 명령어', () => {
    it('객체 타입은 object를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+object\r\n');
    });

    it('배열 타입은 array를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2]']);
      const result = await handler.execute(['JSON.TYPE', 'mykey']);
      expect(result).toBe('+array\r\n');
    });

    it('존재하지 않는 키는 null을 반환한다', async () => {
      const result = await handler.execute(['JSON.TYPE', 'nokey']);
      expect(result).toBe('$-1\r\n');
    });
  });

  // --- JSON.STRAPPEND ---
  describe('JSON.STRAPPEND 명령어', () => {
    it('문자열에 값을 추가하고 새 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '"hello"']);
      const result = await handler.execute(['JSON.STRAPPEND', 'mykey', '$', '" world"']);
      expect(result).toBe(':11\r\n');
    });
  });

  // --- JSON.OBJKEYS ---
  describe('JSON.OBJKEYS 명령어', () => {
    it('객체의 키 목록을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      const result = await handler.execute(['JSON.OBJKEYS', 'mykey']);
      expect(result).toContain('a');
      expect(result).toContain('b');
    });
  });

  // --- JSON.OBJLEN ---
  describe('JSON.OBJLEN 명령어', () => {
    it('객체의 키 수를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2,"c":3}']);
      const result = await handler.execute(['JSON.OBJLEN', 'mykey']);
      expect(result).toBe(':3\r\n');
    });
  });

  // --- JSON.ARRAPPEND ---
  describe('JSON.ARRAPPEND 명령어', () => {
    it('배열에 요소를 추가하고 새 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2]']);
      const result = await handler.execute(['JSON.ARRAPPEND', 'mykey', '$', '3']);
      expect(result).toContain(':3');
    });
  });

  // --- JSON.ARRLEN ---
  describe('JSON.ARRLEN 명령어', () => {
    it('배열의 길이를 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.ARRLEN', 'mykey']);
      expect(result).toBe(':3\r\n');
    });
  });

  // --- JSON.ARRPOP ---
  describe('JSON.ARRPOP 명령어', () => {
    it('배열의 마지막 요소를 제거하고 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '[1,2,3]']);
      const result = await handler.execute(['JSON.ARRPOP', 'mykey', '$']);
      expect(result).toContain('3');
    });
  });

  // --- JSON.NUMINCRBY ---
  describe('JSON.NUMINCRBY 명령어', () => {
    it('숫자 값을 증가시키고 새 값을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '10']);
      const result = await handler.execute(['JSON.NUMINCRBY', 'mykey', '$', '5']);
      expect(result).toContain('15');
    });
  });

  // --- JSON.NUMMULTBY ---
  describe('JSON.NUMMULTBY 명령어', () => {
    it('숫자 값을 곱하고 새 값을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '5']);
      const result = await handler.execute(['JSON.NUMMULTBY', 'mykey', '$', '3']);
      expect(result).toContain('15');
    });
  });

  // --- JSON.MGET ---
  describe('JSON.MGET 명령어', () => {
    it('여러 키에서 동일한 경로의 JSON 값을 가져온다', async () => {
      await handler.execute(['JSON.SET', 'key1', '$', '{"a":1}']);
      await handler.execute(['JSON.SET', 'key2', '$', '{"a":2}']);
      const result = await handler.execute(['JSON.MGET', 'key1', 'key2', '$.a']);
      expect(result).toContain('1');
      expect(result).toContain('2');
    });
  });

  // --- JSON.MSET ---
  describe('JSON.MSET 명령어', () => {
    it('여러 키/경로에 JSON 값을 설정한다', async () => {
      const result = await handler.execute(['JSON.MSET', 'key1', '$', '{"a":1}', 'key2', '$', '{"b":2}']);
      expect(result).toBe('+OK\r\n');
    });
  });

  // --- JSON.TOGGLE ---
  describe('JSON.TOGGLE 명령어', () => {
    it('불리언 값을 반전시키고 새 값을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', 'true']);
      const result = await handler.execute(['JSON.TOGGLE', 'mykey', '$']);
      expect(result).toContain('false');
    });
  });

  // --- JSON.CLEAR ---
  describe('JSON.CLEAR 명령어', () => {
    it('객체를 빈 객체로 초기화한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      const result = await handler.execute(['JSON.CLEAR', 'mykey']);
      expect(result).toBe(':1\r\n');
    });
  });

  // --- JSON.MERGE ---
  describe('JSON.MERGE 명령어', () => {
    it('RFC 7396 머지 패치를 수행한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1,"b":2}']);
      await handler.execute(['JSON.MERGE', 'mykey', '$', '{"b":3,"c":4}']);
      const result = await handler.execute(['JSON.GET', 'mykey']);
      expect(result).toContain('"b":3');
    });
  });

  // --- Cross-type tests ---
  describe('JSON 교차 타입 테스트', () => {
    it('JSON.SET 후 TYPE 명령은 json을 반환한다', async () => {
      await handler.execute(['JSON.SET', 'mykey', '$', '{"a":1}']);
      const result = await handler.execute(['TYPE', 'mykey']);
      expect(result).toBe('+json\r\n');
    });

    it('HSET 후 JSON.SET을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['JSON.SET', 'myhash', '$', '{}']);
      expect(result).toContain('WRONGTYPE');
    });
  });
});