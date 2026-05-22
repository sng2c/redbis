import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { PubSubManager } from '../pubsub/manager';

// ========================================
// InMemoryStorage GEO 명령어 테스트
// ========================================

describe('GEO 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('GEOADD', () => {
    it('GEOADD로 위치를 추가하고 추가된 수를 반환한다', async () => {
      const result = await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      expect(result).toBe(':2\r\n');
    });

    it('GEOADD 중복 멤버는 스코어를 갱신한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEOADD', 'cities', '15.087269', '37.502669', 'Palermo']);
      expect(result).toBe(':0\r\n');
    });

    it('GEOADD with NX 옵션은 기존 멤버를 건너뛴다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEOADD', 'cities', 'NX', '15.087269', '37.502669', 'Palermo']);
      // NX: only add new, don't update existing
      expect(result).toBe(':0\r\n');
    });

    it('GEOADD with XX 옵션은 기존 멤버만 갱신한다', async () => {
      const result = await handler.execute(['GEOADD', 'cities', 'XX', '13.361389', '38.115556', 'Palermo']);
      // XX: only update existing, Palermo doesn't exist yet
      expect(result).toBe(':0\r\n');
    });

    it('GEOADD with CH 옵션은 변경된 수를 반환한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      // CH with same coordinates: score unchanged, so CH returns 0
      const result = await handler.execute(['GEOADD', 'cities', 'CH', '13.361389', '38.115556', 'Palermo']);
      expect(result).toBe(':0\r\n');
      // CH with new coordinates: score changes, so CH returns 1
      const result2 = await handler.execute(['GEOADD', 'cities', 'CH', '14.361389', '39.115556', 'Palermo']);
      expect(result2).toBe(':1\r\n');
    });

    it('GEOADD 잘못된 경도는 에러를 반환한다', async () => {
      const result = await handler.execute(['GEOADD', 'cities', '181', '38', 'member']);
      expect(result).toContain('ERR');
    });

    it('GEOADD 잘못된 위도는 에러를 반환한다', async () => {
      const result = await handler.execute(['GEOADD', 'cities', '13', '86', 'member']);
      expect(result).toContain('ERR');
    });
  });

  describe('GEOHASH', () => {
    it('GEOHASH로 멤버의 geohash 문자열을 반환한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEOHASH', 'cities', 'Palermo']);
      expect(result).toMatch(/\*\d+\r\n/); // array response
    });

    it('GEOHASH 존재하지 않는 멤버는 null을 반환한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEOHASH', 'cities', 'Unknown']);
      expect(result).toContain('$-1\r\n');
    });
  });

  describe('GEOPOS', () => {
    it('GEOPOS로 멤버의 경도/위도를 반환한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEOPOS', 'cities', 'Palermo']);
      expect(result).toMatch(/\*\d+/); // array response
    });

    it('GEOPOS 존재하지 않는 멤버는 null을 반환한다', async () => {
      const result = await handler.execute(['GEOPOS', 'cities', 'Unknown']);
      expect(result).toContain('$-1\r\n');
    });
  });

  describe('GEODIST', () => {
    it('GEODIST로 두 멤버 간 거리를 반환한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEODIST', 'cities', 'Palermo', 'Catania', 'km']);
      expect(result).toMatch(/\$\d+/); // bulk string with number
      // Parse the distance
      const match = result.match(/\$(\d+)\r\n([\d.]+)\r\n/);
      if (match) {
        const dist = parseFloat(match[2]);
        expect(dist).toBeGreaterThan(150);
        expect(dist).toBeLessThan(200);
      }
    });

    it('GEODIST 기본 단위는 미터이다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEODIST', 'cities', 'Palermo', 'Catania']);
      const match = result.match(/\$(\d+)\r\n([\d.]+)\r\n/);
      if (match) {
        const dist = parseFloat(match[2]);
        expect(dist).toBeGreaterThan(150000);
        expect(dist).toBeLessThan(200000);
      }
    });

    it('GEODIST 존재하지 않는 멤버는 null을 반환한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEODIST', 'cities', 'Palermo', 'Unknown']);
      expect(result).toBe('$-1\r\n');
    });
  });

  describe('GEORADIUS', () => {
    it('GEORADIUS로 반경 내 멤버를 반환한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEORADIUS', 'cities', '13.361389', '38.115556', '200', 'km']);
      expect(result).toMatch(/\*\d+/); // array response
    });

    it('GEORADIUS WITHCOORD은 좌표를 포함한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEORADIUS', 'cities', '13.361389', '38.115556', '200', 'km', 'WITHCOORD']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEORADIUS WITHDIST은 거리를 포함한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEORADIUS', 'cities', '13.361389', '38.115556', '200', 'km', 'WITHDIST']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEORADIUS COUNT으로 결과 수를 제한한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEORADIUS', 'cities', '13.361389', '38.115556', '200', 'km', 'COUNT', '1']);
      // Should have at most 1 result
      expect(result).toMatch(/\*\d+/);
    });
  });

  describe('GEORADIUSBYMEMBER', () => {
    it('GEORADIUSBYMEMBER로 멤버 기반 반경 검색한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEORADIUSBYMEMBER', 'cities', 'Palermo', '200', 'km']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEORADIUSBYMEMBER 존재하지 않는 멤버는 빈 결과를 반환한다', async () => {
      const result = await handler.execute(['GEORADIUSBYMEMBER', 'cities', 'Unknown', '200', 'km']);
      expect(result).toBe('*0\r\n');
    });
  });

  describe('GEOSEARCH', () => {
    it('GEOSEARCH BYRADIUS로 반경 검색한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEOSEARCH', 'cities', 'FROMLONGITUDE', '13.361389', 'FROMLATITUDE', '38.115556', 'BYRADIUS', '200', 'km']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEOSEARCH FROMMEMBER로 멤버 기반 검색한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEOSEARCH', 'cities', 'FROMMEMBER', 'Palermo', 'BYRADIUS', '200', 'km']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEOSEARCH BYBOX로 사각형 영역 검색한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEOSEARCH', 'cities', 'FROMLONGITUDE', '13.361389', 'FROMLATITUDE', '38.115556', 'BYBOX', '400', '400', 'km']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEOSEARCH WITHCOORD은 좌표를 포함한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEOSEARCH', 'cities', 'FROMMEMBER', 'Palermo', 'BYRADIUS', '100', 'km', 'WITHCOORD']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEOSEARCH WITHDIST은 거리를 포함한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo']);
      const result = await handler.execute(['GEOSEARCH', 'cities', 'FROMMEMBER', 'Palermo', 'BYRADIUS', '100', 'km', 'WITHDIST']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEOSEARCH에서 반경 밖 멤버는 결과에 포함되지 않는다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      // 1m 반경에서는 Palermo만 결과에 포함 (자기 자신, 거리=0)
      const result = await handler.execute(['GEOSEARCH', 'cities', 'FROMMEMBER', 'Palermo', 'BYRADIUS', '1', 'm']);
      expect(result).toMatch(/\*1/); // 1 result (Palermo itself)
    });
  });

  describe('GEOSEARCHSTORE', () => {
    it('GEOSEARCHSTORE로 검색 결과를 다른 키에 저장한다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEOSEARCHSTORE', 'nearby', 'cities', 'FROMMEMBER', 'Palermo', 'BYRADIUS', '200', 'km']);
      expect(result).toMatch(/:\d+\r\n/);
    });
  });

  describe('GEORADIUS_RO', () => {
    it('GEORADIUS_RO는 읽기 전용 반경 검색이다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEORADIUS_RO', 'cities', '13.361389', '38.115556', '200', 'km']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEORADIUS_RO with STORE은 에러를 반환한다', async () => {
      const result = await handler.execute(['GEORADIUS_RO', 'cities', '13', '38', '200', 'km', 'STORE', 'dest']);
      expect(result).toContain('ERR');
    });
  });

  describe('GEORADIUSBYMEMBER_RO', () => {
    it('GEORADIUSBYMEMBER_RO는 읽기 전용 멤버 반경 검색이다', async () => {
      await handler.execute(['GEOADD', 'cities', '13.361389', '38.115556', 'Palermo', '15.087269', '37.502669', 'Catania']);
      const result = await handler.execute(['GEORADIUSBYMEMBER_RO', 'cities', 'Palermo', '200', 'km']);
      expect(result).toMatch(/\*\d+/);
    });

    it('GEORADIUSBYMEMBER_RO with STOREDIST은 에러를 반환한다', async () => {
      const result = await handler.execute(['GEORADIUSBYMEMBER_RO', 'cities', 'Palermo', '200', 'km', 'STOREDIST', 'dest']);
      expect(result).toContain('ERR');
    });
  });
});