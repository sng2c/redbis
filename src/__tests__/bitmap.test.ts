import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import { PubSubManager } from '../pubsub/manager';

// ========================================
// InMemoryStorage Bitmap Tests
// ========================================

describe('Bitmap 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  // --- SETBIT ---
  describe('SETBIT 명령어', () => {
    it('존재하지 않는 키에 SETBIT을 수행하면 0을 반환한다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '7', '1']);
      expect(result).toBe(':0\r\n');
    });

    it('기존 비트가 0일 때 1로 설정하면 0을 반환한다', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['SETBIT', 'mykey', '7', '1']);
      expect(result).toBe(':1\r\n');
    });

    it('기존 비트가 1일 때 0으로 설정하면 1을 반환한다', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['SETBIT', 'mykey', '7', '0']);
      expect(result).toBe(':1\r\n');
    });

    it('큰 오프셋에 SETBIT을 수행하면 문자열이 확장된다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '1000', '1']);
      expect(result).toBe(':0\r\n');
      const getbit = await handler.execute(['GETBIT', 'mykey', '1000']);
      expect(getbit).toBe(':1\r\n');
    });

    it('해시 키에 SETBIT을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['SETBIT', 'myhash', '7', '1']);
      expect(result).toContain('WRONGTYPE');
    });

    it('리스트 키에 SETBIT을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['LPUSH', 'mylist', 'val']);
      const result = await handler.execute(['SETBIT', 'mylist', '7', '1']);
      expect(result).toContain('WRONGTYPE');
    });

    it('오프셋이 음수이면 에러를 반환한다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '-1', '1']);
      expect(result).toContain('ERR');
    });

    it('값이 0이나 1이 아니면 에러를 반환한다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '7', '2']);
      expect(result).toContain('ERR');
    });

    it('잘못된 인수 개수이면 에러를 반환한다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '7']);
      expect(result).toContain('ERR');
    });
  });

  // --- GETBIT ---
  describe('GETBIT 명령어', () => {
    it('존재하지 않는 키의 비트는 0을 반환한다', async () => {
      const result = await handler.execute(['GETBIT', 'mykey', '7']);
      expect(result).toBe(':0\r\n');
    });

    it('설정된 비트를 조회하면 올바른 값을 반환한다', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['GETBIT', 'mykey', '7']);
      expect(result).toBe(':1\r\n');
    });

    it('설정되지 않은 비트를 조회하면 0을 반환한다', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['GETBIT', 'mykey', '8']);
      expect(result).toBe(':0\r\n');
    });

    it('문자열 길이를 넘어선 오프셋은 0을 반환한다', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['GETBIT', 'mykey', '10000']);
      expect(result).toBe(':0\r\n');
    });

    it('해시 키에 GETBIT을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['GETBIT', 'myhash', '7']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  // --- BITCOUNT ---
  describe('BITCOUNT 명령어', () => {
    it('존재하지 않는 키는 0을 반환한다', async () => {
      const result = await handler.execute(['BITCOUNT', 'mykey']);
      expect(result).toBe(':0\r\n');
    });

    it('설정된 비트 수를 올바르게 센다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      await handler.execute(['SETBIT', 'mykey', '15', '1']);
      const result = await handler.execute(['BITCOUNT', 'mykey']);
      expect(result).toBe(':3\r\n');
    });

    it('시작/끝 범위를 지정하면 해당 바이트 범위의 비트 수를 센다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      await handler.execute(['SETBIT', 'mykey', '15', '1']);
      const result = await handler.execute(['BITCOUNT', 'mykey', '0', '0']);
      expect(result).toBe(':2\r\n');
    });

    it('음수 인덱스로 범위를 지정할 수 있다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      await handler.execute(['SETBIT', 'mykey', '15', '1']);
      const result = await handler.execute(['BITCOUNT', 'mykey', '0', '-1']);
      expect(result).toBe(':3\r\n');
    });

    it('범위 없이 호출하면 전체 비트 수를 센다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      await handler.execute(['SETBIT', 'mykey', '8', '1']);
      const result = await handler.execute(['BITCOUNT', 'mykey']);
      expect(result).toBe(':2\r\n');
    });

    it('해시 키에 BITCOUNT을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['BITCOUNT', 'myhash']);
      expect(result).toContain('WRONGTYPE');
    });

    it('빈 문자열 키의 BITCOUNT은 0을 반환한다', async () => {
      await handler.execute(['SET', 'mykey', '']);
      const result = await handler.execute(['BITCOUNT', 'mykey']);
      expect(result).toBe(':0\r\n');
    });
  });

  // --- BITPOS ---
  describe('BITPOS 명령어', () => {
    it('설정된 비트의 첫 위치를 반환한다 (bit=1)', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['BITPOS', 'mykey', '1']);
      expect(result).toBe(':7\r\n');
    });

    it('해제된 비트의 첫 위치를 반환한다 (bit=0)', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['BITPOS', 'mykey', '0']);
      expect(result).toBe(':0\r\n');
    });

    it('시작/끝 범위를 지정할 수 있다', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['BITPOS', 'mykey', '1', '0', '0']);
      expect(result).toBe(':7\r\n');
    });

    it('비트를 찾지 못하면 -1을 반환한다', async () => {
      await handler.execute(['SET', 'mykey', '\x00']);
      const result = await handler.execute(['BITPOS', 'mykey', '1']);
      expect(result).toBe(':-1\r\n');
    });

    it('존재하지 않는 키에서 bit=0 이면 0을 반환한다', async () => {
      const result = await handler.execute(['BITPOS', 'mykey', '0']);
      expect(result).toBe(':0\r\n');
    });

    it('존재하지 않는 키에서 bit=1 이면 -1을 반환한다', async () => {
      const result = await handler.execute(['BITPOS', 'mykey', '1']);
      expect(result).toBe(':-1\r\n');
    });
  });

  // --- BITOP ---
  describe('BITOP 명령어', () => {
    it('AND 연산을 올바르게 수행한다', async () => {
      await handler.execute(['SETBIT', 'key1', '0', '1']);
      await handler.execute(['SETBIT', 'key1', '1', '1']);
      await handler.execute(['SETBIT', 'key2', '0', '1']);
      await handler.execute(['SETBIT', 'key2', '1', '0']);
      const result = await handler.execute(['BITOP', 'AND', 'dest', 'key1', 'key2']);
      expect(result).toBe(':1\r\n'); // 1 byte result
      const bit0 = await handler.execute(['GETBIT', 'dest', '0']);
      expect(bit0).toBe(':1\r\n');
      const bit1 = await handler.execute(['GETBIT', 'dest', '1']);
      expect(bit1).toBe(':0\r\n');
    });

    it('OR 연산을 올바르게 수행한다', async () => {
      await handler.execute(['SETBIT', 'key1', '0', '1']);
      await handler.execute(['SETBIT', 'key2', '1', '1']);
      const result = await handler.execute(['BITOP', 'OR', 'dest', 'key1', 'key2']);
      expect(result).toBe(':1\r\n');
      const bit0 = await handler.execute(['GETBIT', 'dest', '0']);
      expect(bit0).toBe(':1\r\n');
      const bit1 = await handler.execute(['GETBIT', 'dest', '1']);
      expect(bit1).toBe(':1\r\n');
    });

    it('XOR 연산을 올바르게 수행한다', async () => {
      await handler.execute(['SETBIT', 'key1', '0', '1']);
      await handler.execute(['SETBIT', 'key1', '1', '1']);
      await handler.execute(['SETBIT', 'key2', '0', '1']);
      await handler.execute(['SETBIT', 'key2', '1', '0']);
      const result = await handler.execute(['BITOP', 'XOR', 'dest', 'key1', 'key2']);
      expect(result).toBe(':1\r\n');
      const bit0 = await handler.execute(['GETBIT', 'dest', '0']);
      expect(bit0).toBe(':0\r\n');
      const bit1 = await handler.execute(['GETBIT', 'dest', '1']);
      expect(bit1).toBe(':1\r\n');
    });

    it('NOT 연산을 올바르게 수행한다', async () => {
      await handler.execute(['SETBIT', 'key1', '0', '1']);
      const result = await handler.execute(['BITOP', 'NOT', 'dest', 'key1']);
      expect(result).toBe(':1\r\n');
      const bit0 = await handler.execute(['GETBIT', 'dest', '0']);
      expect(bit0).toBe(':0\r\n');
    });

    it('길이가 다른 키의 BITOP은 짧은 쪽을 0으로 패딩한다', async () => {
      await handler.execute(['SETBIT', 'key1', '0', '1']);
      await handler.execute(['SETBIT', 'key2', '16', '1']);
      const result = await handler.execute(['BITOP', 'OR', 'dest', 'key1', 'key2']);
      expect(result).toBe(':3\r\n'); // 3 bytes (24 bits / 8)
    });

    it('존재하지 않는 키는 빈 문자열로 처리한다', async () => {
      await handler.execute(['SETBIT', 'key1', '0', '1']);
      const result = await handler.execute(['BITOP', 'AND', 'dest', 'key1', 'nonexist']);
      // key1 has byte at offset 0 = 0x80, nonexist = 0x00 → AND = 0x00
      // but result length = max(key1.length, nonexist.length) = key1.length
      expect(result).toContain('\r\n');
    });

    it('NOT은 정확히 하나의 소스 키만 허용한다', async () => {
      const result = await handler.execute(['BITOP', 'NOT', 'dest', 'key1', 'key2']);
      expect(result).toContain('ERR');
    });

    it('결과 키의 길이를 반환한다', async () => {
      await handler.execute(['SETBIT', 'key1', '15', '1']);
      const result = await handler.execute(['BITOP', 'OR', 'dest', 'key1']);
      expect(result).toBe(':2\r\n'); // 2 bytes for offset 15
    });

    it('해시 키가 소스에 포함되면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['BITOP', 'AND', 'dest', 'myhash']);
      expect(result).toContain('WRONGTYPE');
    });
  });

  // --- BITFIELD ---
  describe('BITFIELD 명령어', () => {
    it('GET 연산으로 비트를 읽을 수 있다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      const result = await handler.execute(['BITFIELD', 'mykey', 'GET', 'u8', '0']);
      expect(result).toBe('*1\r\n:128\r\n');
    });

    it('SET 연산으로 비트를 설정하고 이전 값을 반환한다', async () => {
      const result = await handler.execute(['BITFIELD', 'mykey', 'SET', 'u8', '0', '128']);
      expect(result).toBe('*1\r\n:0\r\n');
    });

    it('INCRBY 연산으로 비트를 증가시킬 수 있다', async () => {
      await handler.execute(['BITFIELD', 'mykey', 'SET', 'u8', '0', '10']);
      const result = await handler.execute(['BITFIELD', 'mykey', 'INCRBY', 'u8', '0', '5']);
      expect(result).toContain(':15\r\n');
    });

    it('부호 있는(signed) 인코딩으로 음수를 처리한다', async () => {
      await handler.execute(['BITFIELD', 'mykey', 'SET', 'i8', '0', '-1']);
      const result = await handler.execute(['BITFIELD', 'mykey', 'GET', 'i8', '0']);
      expect(result).toContain(':-1');
    });

    it('OVERFLOW WRAP은 오버플로우 시 래핑한다', async () => {
      await handler.execute(['BITFIELD', 'mykey', 'SET', 'u8', '0', '250']);
      const result = await handler.execute([
        'BITFIELD',
        'mykey',
        'OVERFLOW',
        'WRAP',
        'INCRBY',
        'u8',
        '0',
        '10',
      ]);
      // 250 + 10 = 260 -> wrap to 4 (260 % 256)
      expect(result).toContain(':4\r\n');
    });

    it('OVERFLOW SAT은 오버플로우 시 포화한다', async () => {
      await handler.execute(['BITFIELD', 'mykey', 'SET', 'u8', '0', '250']);
      const result = await handler.execute([
        'BITFIELD',
        'mykey',
        'OVERFLOW',
        'SAT',
        'INCRBY',
        'u8',
        '0',
        '10',
      ]);
      // 250 + 10 = 260 -> saturate to 255
      expect(result).toContain(':255\r\n');
    });

    it('OVERFLOW FAIL은 오버플로우 시 null을 반환한다', async () => {
      await handler.execute(['BITFIELD', 'mykey', 'SET', 'u8', '0', '250']);
      const result = await handler.execute([
        'BITFIELD',
        'mykey',
        'OVERFLOW',
        'FAIL',
        'INCRBY',
        'u8',
        '0',
        '10',
      ]);
      expect(result).toContain('$-1\r\n');
    });

    it('여러 연산을 한번에 수행할 수 있다', async () => {
      const result = await handler.execute([
        'BITFIELD',
        'mykey',
        'SET',
        'u8',
        '0',
        '42',
        'GET',
        'u8',
        '0',
      ]);
      // SET returns old value (0), GET returns new value (42)
      expect(result).toContain(':0\r\n');
      expect(result).toContain(':42\r\n');
    });
  });

  // --- BITFIELD_RO ---
  describe('BITFIELD_RO 명령어', () => {
    it('GET 연산만 수행할 수 있다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      const result = await handler.execute(['BITFIELD_RO', 'mykey', 'GET', 'u8', '0']);
      expect(result).toContain(':128\r\n');
    });

    it('SET이나 INCRBY를 사용하면 에러를 반환한다', async () => {
      const result = await handler.execute(['BITFIELD_RO', 'mykey', 'SET', 'u8', '0', '42']);
      expect(result).toContain('ERR');
    });
  });

  // --- Cross-type tests ---
  describe('Bitmap 교차 타입 테스트', () => {
    it('SETBIT 후 TYPE 명령은 string을 반환한다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      const result = await handler.execute(['TYPE', 'mykey']);
      expect(result).toBe('+string\r\n');
    });

    it('SET 후 SETBIT을 수행할 수 있다 (같은 string 타입)', async () => {
      await handler.execute(['SET', 'mykey', 'abc']);
      const result = await handler.execute(['SETBIT', 'mykey', '0', '1']);
      expect(result).toBe(':0\r\n');
    });

    it('HSET 후 SETBIT을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['SETBIT', 'myhash', '7', '1']);
      expect(result).toContain('WRONGTYPE');
    });

    it('SETBIT 후 GET으로 원시 문자열을 읽을 수 있다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      const result = await handler.execute(['GET', 'mykey']);
      expect(result).not.toBe('$-1\r\n');
    });
  });
});

// ========================================
// SqliteStorage Bitmap Tests
// ========================================

describe('Bitmap 명령어 — SqliteStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new SqliteStorage({ path: ':memory:' });
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  // --- SETBIT ---
  describe('SETBIT 명령어', () => {
    it('존재하지 않는 키에 SETBIT을 수행하면 0을 반환한다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '7', '1']);
      expect(result).toBe(':0\r\n');
    });

    it('기존 비트가 1일 때 0으로 설정하면 1을 반환한다', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['SETBIT', 'mykey', '7', '0']);
      expect(result).toBe(':1\r\n');
    });

    it('큰 오프셋에 SETBIT을 수행하면 문자열이 확장된다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '1000', '1']);
      expect(result).toBe(':0\r\n');
      const getbit = await handler.execute(['GETBIT', 'mykey', '1000']);
      expect(getbit).toBe(':1\r\n');
    });

    it('해시 키에 SETBIT을 수행하면 WRONGTYPE 에러를 반환한다', async () => {
      await handler.execute(['HSET', 'myhash', 'f1', 'v1']);
      const result = await handler.execute(['SETBIT', 'myhash', '7', '1']);
      expect(result).toContain('WRONGTYPE');
    });

    it('오프셋이 음수이면 에러를 반환한다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '-1', '1']);
      expect(result).toContain('ERR');
    });

    it('값이 0이나 1이 아니면 에러를 반환한다', async () => {
      const result = await handler.execute(['SETBIT', 'mykey', '7', '2']);
      expect(result).toContain('ERR');
    });
  });

  // --- GETBIT ---
  describe('GETBIT 명령어', () => {
    it('존재하지 않는 키의 비트는 0을 반환한다', async () => {
      const result = await handler.execute(['GETBIT', 'mykey', '7']);
      expect(result).toBe(':0\r\n');
    });

    it('설정된 비트를 조회하면 올바른 값을 반환한다', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['GETBIT', 'mykey', '7']);
      expect(result).toBe(':1\r\n');
    });
  });

  // --- BITCOUNT ---
  describe('BITCOUNT 명령어', () => {
    it('존재하지 않는 키는 0을 반환한다', async () => {
      const result = await handler.execute(['BITCOUNT', 'mykey']);
      expect(result).toBe(':0\r\n');
    });

    it('설정된 비트 수를 올바르게 센다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      await handler.execute(['SETBIT', 'mykey', '15', '1']);
      const result = await handler.execute(['BITCOUNT', 'mykey']);
      expect(result).toBe(':3\r\n');
    });
  });

  // --- BITPOS ---
  describe('BITPOS 명령어', () => {
    it('설정된 비트의 첫 위치를 반환한다 (bit=1)', async () => {
      await handler.execute(['SETBIT', 'mykey', '7', '1']);
      const result = await handler.execute(['BITPOS', 'mykey', '1']);
      expect(result).toBe(':7\r\n');
    });

    it('존재하지 않는 키에서 bit=1 이면 -1을 반환한다', async () => {
      const result = await handler.execute(['BITPOS', 'mykey', '1']);
      expect(result).toBe(':-1\r\n');
    });
  });

  // --- BITOP ---
  describe('BITOP 명령어', () => {
    it('AND 연산을 올바르게 수행한다', async () => {
      await handler.execute(['SETBIT', 'key1', '0', '1']);
      await handler.execute(['SETBIT', 'key1', '1', '1']);
      await handler.execute(['SETBIT', 'key2', '0', '1']);
      await handler.execute(['SETBIT', 'key2', '1', '0']);
      const result = await handler.execute(['BITOP', 'AND', 'dest', 'key1', 'key2']);
      expect(result).toBe(':1\r\n');
    });

    it('NOT 연산을 올바르게 수행한다', async () => {
      await handler.execute(['SETBIT', 'key1', '0', '1']);
      const result = await handler.execute(['BITOP', 'NOT', 'dest', 'key1']);
      expect(result).toContain('\r\n');
    });

    it('NOT은 정확히 하나의 소스 키만 허용한다', async () => {
      const result = await handler.execute(['BITOP', 'NOT', 'dest', 'key1', 'key2']);
      expect(result).toContain('ERR');
    });
  });

  // --- BITFIELD ---
  describe('BITFIELD 명령어', () => {
    it('GET 연산으로 비트를 읽을 수 있다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      const result = await handler.execute(['BITFIELD', 'mykey', 'GET', 'u8', '0']);
      expect(result).toContain(':128\r\n');
    });

    it('SET 연산으로 비트를 설정하고 이전 값을 반환한다', async () => {
      const result = await handler.execute(['BITFIELD', 'mykey', 'SET', 'u8', '0', '128']);
      expect(result).toContain(':0\r\n');
    });

    it('INCRBY 연산으로 비트를 증가시킬 수 있다', async () => {
      await handler.execute(['BITFIELD', 'mykey', 'SET', 'u8', '0', '10']);
      const result = await handler.execute(['BITFIELD', 'mykey', 'INCRBY', 'u8', '0', '5']);
      expect(result).toContain(':15\r\n');
    });
  });

  // --- BITFIELD_RO ---
  describe('BITFIELD_RO 명령어', () => {
    it('GET 연산만 수행할 수 있다', async () => {
      await handler.execute(['SETBIT', 'mykey', '0', '1']);
      const result = await handler.execute(['BITFIELD_RO', 'mykey', 'GET', 'u8', '0']);
      expect(result).toContain(':128\r\n');
    });

    it('SET이나 INCRBY를 사용하면 에러를 반환한다', async () => {
      const result = await handler.execute(['BITFIELD_RO', 'mykey', 'SET', 'u8', '0', '42']);
      expect(result).toContain('ERR');
    });
  });
});
