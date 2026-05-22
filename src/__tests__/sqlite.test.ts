import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../storage/sqlite';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SqliteStorage', () => {
  let storage: SqliteStorage;

  beforeEach(() => {
    storage = new SqliteStorage({ path: ':memory:' });
  });

  it('SqliteStorage 인스턴스를 생성할 수 있다', () => {
    expect(storage).toBeInstanceOf(SqliteStorage);
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

  describe('SQL 특수문자 포함 값의 set/get', () => {
    it('작은따옴표, 세미콜론, 대시 등 SQL 특수문자가 포함된 값을 정확히 저장·조회한다', async () => {
      const specialValues = [
        "value with 'quotes'",
        "value; DROP TABLE kv_store; --",
        "OR 1=1",
        "-- comment",
        "'; --",
        "normal_value",
      ];
      for (const val of specialValues) {
        const key = `key_${val.length}`;
        await storage.set(key, val);
        const result = await storage.get(key);
        expect(result).toBe(val);
      }
    });
  });

  describe('SQL 특수문자 포함 키의 set/get/delete', () => {
    it('작은따옴표, 세미콜론 등이 포함된 키로 set/get/delete가 정확히 동작한다', async () => {
      const specialKeys = [
        "key'with'quotes",
        "key;semicolon",
        "key--dash",
        "key OR 1=1",
      ];
      for (const key of specialKeys) {
        await storage.set(key, `value_of_${key}`);
      }
      for (const key of specialKeys) {
        const result = await storage.get(key);
        expect(result).toBe(`value_of_${key}`);
      }
      // delete 테스트
      const deleted = await storage.delete("key'with'quotes");
      expect(deleted).toBe(true);
      expect(await storage.get("key'with'quotes")).toBeNull();
    });
  });

  describe('파일 DB 영속성 테스트', () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redbis-test-'));
      dbPath = path.join(tmpDir, 'test.db');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('파일 DB에서 set 후 get이 데이터를 영속적으로 보존한다', async () => {
      // 첫 번째 인스턴스에서 데이터 쓰기
      const storage1 = new SqliteStorage({ path: dbPath });
      await storage1.set('persist_key', 'persist_value');
      // 인스턴스를 명시적으로 닫지 않아도 better-sqlite3는 동기식이므로 바로 반영됨

      // 두 번째 인스턴스에서 데이터 조회
      const storage2 = new SqliteStorage({ path: dbPath });
      const result = await storage2.get('persist_key');
      expect(result).toBe('persist_value');
    });
  });

  describe('동시 set 연산', () => {
    it('여러 키를 동시에 set한 후 모두 get 가능하다', async () => {
      const count = 50;
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(storage.set(`concurrent_key_${i}`, `concurrent_val_${i}`));
      }
      await Promise.all(promises);

      for (let i = 0; i < count; i++) {
        const result = await storage.get(`concurrent_key_${i}`);
        expect(result).toBe(`concurrent_val_${i}`);
      }
    });
  });

  describe('동시 set/get/delete 혼합 연산', () => {
    it('race condition 없이 모두 정상 동작한다', async () => {
      // 초기 데이터 설정
      await storage.set('mix_key1', 'mix_val1');
      await storage.set('mix_key2', 'mix_val2');

      const operations = [
        storage.set('mix_key1', 'updated_val1'),
        storage.get('mix_key2'),
        storage.delete('mix_key2'),
        storage.set('mix_key3', 'mix_val3'),
      ];
      await Promise.all(operations);

      // 최종 상태 검증
      expect(await storage.get('mix_key1')).toBe('updated_val1');
      expect(await storage.get('mix_key2')).toBeNull(); // 삭제됨
      expect(await storage.get('mix_key3')).toBe('mix_val3');
    });
  });

  describe('flush 후 빈 상태 확인', () => {
    it('flush 후 keys(*)가 빈 배열을 반환한다', async () => {
      await storage.set('fkey1', 'fval1');
      await storage.set('fkey2', 'fval2');
      await storage.flush();
      const result = await storage.keys('*');
      expect(result).toEqual([]);
    });
  });

  describe('매우 긴 문자열 값의 set/get', () => {
    it('10,000자 이상 문자열이 정확히 저장·조회된다', async () => {
      const longValue = 'A'.repeat(10000);
      await storage.set('long_key', longValue);
      const result = await storage.get('long_key');
      expect(result).toBe(longValue);
      expect(result!.length).toBe(10000);
    });
  });

  describe('이모지 포함 값의 set/get', () => {
    it('이모지, 한글, 일본어 등 유니코드 값이 정확히 저장·조회된다', async () => {
      const unicodeValues = [
        { key: 'emoji', value: '🎉🎊🎈' },
        { key: 'korean', value: '한글테스트' },
        { key: 'japanese', value: '日本語テスト' },
        { key: 'mixed', value: 'Hello🎉世界' },
      ];
      for (const { key, value } of unicodeValues) {
        await storage.set(key, value);
      }
      for (const { key, value } of unicodeValues) {
        const result = await storage.get(key);
        expect(result).toBe(value);
      }
    });
  });

  describe('GEO 명령어 — SqliteStorage', () => {
    it('GEOADD로 위치를 추가한다', async () => {
      const result = await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      expect(result).toBe(2);
    });

    it('GEOADD 중복 멤버는 스코어를 갱신한다', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const result = await storage.geoadd('cities', [{ longitude: 15.087269, latitude: 37.502669, member: 'Palermo' }]);
      expect(result).toBe(0);
    });

    it('GEOADD with CH 옵션', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const result = await storage.geoadd('cities', [{ longitude: 14.361389, latitude: 39.115556, member: 'Palermo' }], { ch: true });
      expect(result).toBe(1);
    });

    it('GEOADD with NX 옵션은 기존 멤버를 건너뛴다', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const result = await storage.geoadd('cities', [{ longitude: 15, latitude: 37, member: 'Palermo' }], { nx: true });
      expect(result).toBe(0);
    });

    it('GEOADD with XX 옵션은 기존 멤버만 갱신한다', async () => {
      const result = await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }], { xx: true });
      expect(result).toBe(0);
    });

    it('GEOADD 잘못된 경도는 에러를 던진다', async () => {
      await expect(storage.geoadd('cities', [{ longitude: 181, latitude: 38, member: 'm' }])).rejects.toThrow();
    });

    it('GEOHASH로 geohash 문자열을 반환한다', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const result = await storage.geohash('cities', ['Palermo']);
      expect(result[0]).not.toBeNull();
    });

    it('GEOHASH 존재하지 않는 멤버는 null', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const result = await storage.geohash('cities', ['Unknown']);
      expect(result[0]).toBeNull();
    });

    it('GEOPOS로 멤버의 경도/위도를 반환한다', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const result = await storage.geopos('cities', ['Palermo']);
      expect(result[0]).not.toBeNull();
      expect(result[0]![0]).toBeCloseTo(13.361389, 1);
      expect(result[0]![1]).toBeCloseTo(38.115556, 1);
    });

    it('GEOPOS 존재하지 않는 멤버는 null', async () => {
      const result = await storage.geopos('cities', ['Unknown']);
      expect(result[0]).toBeNull();
    });

    it('GEODIST로 두 멤버 간 거리를 반환한다', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      const dist = await storage.geodist('cities', 'Palermo', 'Catania', 'km');
      expect(dist).not.toBeNull();
      expect(dist!).toBeGreaterThan(150);
      expect(dist!).toBeLessThan(200);
    });

    it('GEODIST 존재하지 않는 멤버는 null', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const result = await storage.geodist('cities', 'Palermo', 'Unknown', 'km');
      expect(result).toBeNull();
    });

    it('GEORADIUS로 반경 내 멤버를 검색한다', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      const results = await storage.georadius('cities', 13.361389, 38.115556, 200, 'km');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.member === 'Palermo')).toBe(true);
    });

    it('GEORADIUSBYMEMBER로 멤버 기반 반경 검색한다', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      const results = await storage.georadiusbymember('cities', 'Palermo', 200, 'km');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('GEOSEARCH BYRADIUS로 반경 검색한다', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      const results = await storage.geosearch('cities', {
        fromLongitude: 13.361389, fromLatitude: 38.115556,
        byRadius: { radius: 200, unit: 'km' },
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('GEOSEARCH FROMMEMBER로 검색한다', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      const results = await storage.geosearch('cities', {
        fromMember: 'Palermo',
        byRadius: { radius: 200, unit: 'km' },
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('GEOSEARCH BYBOX로 사각형 검색한다', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const results = await storage.geosearch('cities', {
        fromLongitude: 13.361389, fromLatitude: 38.115556,
        byBox: { width: 400, height: 400, unit: 'km' },
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('GEOSEARCH withDist 옵션', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      const results = await storage.geosearch('cities', {
        fromMember: 'Palermo',
        byRadius: { radius: 200, unit: 'km' },
        withDist: true,
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].distance).toBeDefined();
    });

    it('GEOSEARCH withCoord 옵션', async () => {
      await storage.geoadd('cities', [{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }]);
      const results = await storage.geosearch('cities', {
        fromMember: 'Palermo',
        byRadius: { radius: 200, unit: 'km' },
        withCoord: true,
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].longitude).toBeDefined();
      expect(results[0].latitude).toBeDefined();
    });

    it('GEOSEARCHSTORE로 검색 결과를 저장한다', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      const count = await storage.geosearchstore('nearby', 'cities', {
        fromMember: 'Palermo',
        byRadius: { radius: 200, unit: 'km' },
      });
      expect(count).toBeGreaterThanOrEqual(1);
      const type = await storage.type('nearby');
      expect(type).toBe('zset');
    });

    it('GEORADIUS with STORE 옵션', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      await storage.georadius('cities', 13.361389, 38.115556, 200, 'km', { store: 'nearby2' });
      const type = await storage.type('nearby2');
      expect(type).toBe('zset');
    });

    it('GEORADIUS with STOREDIST 옵션', async () => {
      await storage.geoadd('cities', [
        { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
      ]);
      await storage.georadius('cities', 13.361389, 38.115556, 200, 'km', { storeDist: 'nearby3' });
      const type = await storage.type('nearby3');
      expect(type).toBe('zset');
    });
  });
});
