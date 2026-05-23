import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';
import type { GeoSearchResult } from '../storage/interface';

const storageProviders = [
  { name: 'InMemoryStorage', create: () => new InMemoryStorage() },
  { name: 'SqliteStorage', create: () => new SqliteStorage({ path: ':memory:' }) },
];

for (const { name, create } of storageProviders) {
  describe(`GEOSEARCH/GEOSEARCHSTORE — ${name}`, () => {
    let storage: InMemoryStorage | SqliteStorage;

    beforeEach(async () => {
      storage = create();
      await storage.flush();
    });

    // ========================================================
    // GEOSEARCH BYRADIUS from longitude/latitude
    // ========================================================
    describe('GEOSEARCH BYRADIUS', () => {
      it('GEOSEARCH BYRADIUS — 반경 내 멤버를 반환한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
        ]);
        const results = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 200, unit: 'km' },
        });
        const members = results.map((r) => r.member);
        expect(members).toContain('Palermo');
        expect(members).toContain('Catania');
      });

      it('GEOSEARCH BYRADIUS — 반경 밖 멤버는 포함하지 않는다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
        ]);
        // 1m 반경에서는 Palermo만 결과에 포함 (자기 자신, 거리=0)
        const results = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 1, unit: 'm' },
        });
        const members = results.map((r) => r.member);
        expect(members).toContain('Palermo');
        expect(members).not.toContain('Catania');
      });

      it('GEOSEARCH BYRADIUS — 존재하지 않는 키는 빈 배열을 반환한다', async () => {
        const results = await storage.geosearch('nokey', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 200, unit: 'km' },
        });
        expect(results).toEqual([]);
      });
    });

    // ========================================================
    // GEOSEARCH FROMMEMBER
    // ========================================================
    describe('GEOSEARCH FROMMEMBER', () => {
      it('GEOSEARCH FROMMEMBER — 멤버 기준으로 반경 검색한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
        ]);
        const results = await storage.geosearch('cities', {
          fromMember: 'Palermo',
          byRadius: { radius: 200, unit: 'km' },
        });
        const members = results.map((r) => r.member);
        expect(members).toContain('Palermo');
        expect(members).toContain('Catania');
      });

      it('GEOSEARCH FROMMEMBER — 존재하지 않는 멤버는 빈 결과를 반환한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        ]);
        const results = await storage.geosearch('cities', {
          fromMember: 'Unknown',
          byRadius: { radius: 200, unit: 'km' },
        });
        expect(results).toEqual([]);
      });
    });

    // ========================================================
    // GEOSEARCH BYBOX
    // ========================================================
    describe('GEOSEARCH BYBOX', () => {
      it('GEOSEARCH BYBOX — 사각형 영역 내 멤버를 반환한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        ]);
        const results = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byBox: { width: 400, height: 400, unit: 'km' },
        });
        const members = results.map((r) => r.member);
        expect(members).toContain('Palermo');
      });

      it('GEOSEARCH BYBOX — 너무 작은 박스는 결과가 없다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
        ]);
        // 아주 작은 박스(1m × 1m)를 멀리 떨어진 좌표에서 검색
        const results = await storage.geosearch('cities', {
          fromLongitude: 0,
          fromLatitude: 0,
          byBox: { width: 1, height: 1, unit: 'm' },
        });
        expect(results).toEqual([]);
      });
    });

    // ========================================================
    // GEOSEARCH with sort and count
    // ========================================================
    describe('GEOSEARCH 정렬 및 제한', () => {
      it('GEOSEARCH — ASC 정렬로 결과를 반환한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
          { longitude: 12.496365, latitude: 41.902782, member: 'Rome' },
        ]);
        const results = await storage.geosearch('cities', {
          fromMember: 'Palermo',
          byRadius: { radius: 500, unit: 'km' },
          sort: 'ASC',
          withDist: true,
        });
        // 가까운 순으로 정렬: Palermo(0km), Catania(~166km), Rome(~...)
        expect(results.length).toBe(3);
        const distances = results.map((r) => r.distance!);
        for (let i = 1; i < distances.length; i++) {
          expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
        }
      });

      it('GEOSEARCH — DESC 정렬로 결과를 반환한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
          { longitude: 12.496365, latitude: 41.902782, member: 'Rome' },
        ]);
        const results = await storage.geosearch('cities', {
          fromMember: 'Palermo',
          byRadius: { radius: 500, unit: 'km' },
          sort: 'DESC',
          withDist: true,
        });
        // 먼 순으로 정렬
        expect(results.length).toBe(3);
        const distances = results.map((r) => r.distance!);
        for (let i = 1; i < distances.length; i++) {
          expect(distances[i]).toBeLessThanOrEqual(distances[i - 1]!);
        }
      });

      it('GEOSEARCH — COUNT로 결과 수를 제한한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
          { longitude: 12.496365, latitude: 41.902782, member: 'Rome' },
        ]);
        const results = await storage.geosearch('cities', {
          fromMember: 'Palermo',
          byRadius: { radius: 500, unit: 'km' },
          count: 1,
        });
        expect(results.length).toBe(1);
      });
    });

    // ========================================================
    // GEOSEARCH with options (withDist, withCoord, withHash)
    // ========================================================
    describe('GEOSEARCH 옵션', () => {
      it('GEOSEARCH — withDist 옵션으로 거리를 포함한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
        ]);
        const results = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 200, unit: 'km' },
          withDist: true,
        });
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
          expect(r.distance).toBeDefined();
          expect(typeof r.distance).toBe('number');
        }
      });

      it('GEOSEARCH — withCoord 옵션으로 좌표를 포함한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        ]);
        const results = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 200, unit: 'km' },
          withCoord: true,
        });
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
          expect(r.longitude).toBeDefined();
          expect(r.latitude).toBeDefined();
          expect(typeof r.longitude).toBe('number');
          expect(typeof r.latitude).toBe('number');
        }
      });

      it('GEOSEARCH — withHash 옵션으로 해시를 포함한다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
        ]);
        const results = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 200, unit: 'km' },
          withHash: true,
        });
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
          expect(r.geohash).toBeDefined();
          expect(typeof r.geohash).toBe('string');
        }
      });
    });

    // ========================================================
    // GEOSEARCHSTORE
    // ========================================================
    describe('GEOSEARCHSTORE', () => {
      it('GEOSEARCHSTORE — 검색 결과를 새 키에 저장하고 멤버 수를 반환한다', async () => {
        await storage.geoadd('source', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
        ]);
        const count = await storage.geosearchstore('dest', 'source', {
          fromMember: 'Palermo',
          byRadius: { radius: 200, unit: 'km' },
        });
        expect(count).toBe(2);

        // dest 키에 결과가 저장되었는지 확인
        const destResults = await storage.geosearch('dest', {
          fromMember: 'Palermo',
          byRadius: { radius: 200, unit: 'km' },
        });
        const destMembers = destResults.map((r) => r.member);
        expect(destMembers).toContain('Palermo');
        expect(destMembers).toContain('Catania');
      });

      it('GEOSEARCHSTORE — storeDist 옵션으로 거리를 스코어로 저장한다', async () => {
        await storage.geoadd('source', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
        ]);
        const count = await storage.geosearchstore('dest', 'source', {
          fromMember: 'Palermo',
          byRadius: { radius: 200, unit: 'km' },
          storeDist: true,
        });
        expect(count).toBe(2);

        // storeDist가 true이면 dest zset의 score가 거리(km)여야 한다
        // Palermo은 자기 자신이므로 거리가 0에 가깝다
        const palermoScore = await storage.zscore('dest', 'Palermo');
        expect(palermoScore).not.toBeNull();
        expect(parseFloat(palermoScore!)).toBeCloseTo(0, 0);

        // Catania 거리는 Palermo에서 ~166km
        const cataniaScore = await storage.zscore('dest', 'Catania');
        expect(cataniaScore).not.toBeNull();
        expect(parseFloat(cataniaScore!)).toBeGreaterThan(100);
      });
    });

    // ========================================================
    // Unit conversions
    // ========================================================
    describe('GEOSEARCH 단위 변환', () => {
      it('GEOSEARCH — 단위 변환 (m, km, ft, mi)이 올바르다', async () => {
        await storage.geoadd('cities', [
          { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
          { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
        ]);

        // 미터 단위 (200km = 200000m)
        const resultsM = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 200000, unit: 'm' },
        });
        expect(resultsM.map((r) => r.member)).toContain('Catania');

        // 킬로미터 단위
        const resultsKm = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 200, unit: 'km' },
        });
        expect(resultsKm.map((r) => r.member)).toContain('Catania');

        // 마일 단위 (200km ≈ 124.27mi)
        const resultsMi = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 125, unit: 'mi' },
        });
        expect(resultsMi.map((r) => r.member)).toContain('Catania');

        // 피트 단위 (200km ≈ 656168ft)
        const resultsFt = await storage.geosearch('cities', {
          fromLongitude: 13.361389,
          fromLatitude: 38.115556,
          byRadius: { radius: 656168, unit: 'ft' },
        });
        expect(resultsFt.map((r) => r.member)).toContain('Catania');
      });
    });
  });
}