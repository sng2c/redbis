// @ts-nocheck
import type { SqliteStorage } from './core';
import { encodeGeohash, decodeGeohash, geohashToString, calculateDistance, getBoundingBox, isInRadius, convertToMeters, convertFromMeters } from '../../utils/geo';
import type { GeoSearchResult } from '../../utils/geo';

export const geoMethods = {
_ensureGeoTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'zset') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
  },

_unitToMeters(unit: 'm' | 'km' | 'ft' | 'mi'): number {
    switch (unit) {
      case 'km': return 1000;
      case 'ft': return 0.3048;
      case 'mi': return 1609.34;
      case 'm':
      default: return 1;
    }
  },

async geoadd(key: string, members: Array<{ longitude: number; latitude: number; member: string }>, options?: { nx?: boolean; xx?: boolean; ch?: boolean }): Promise<number> {
    this.evictExpired(key);
    this._ensureGeoTypeOrThrow(key);

    // Validate coordinates
    for (const { longitude, latitude } of members) {
      if (longitude < -180 || longitude > 180) {
        throw new Error('ERR invalid longitude,valid range is [-180,180]');
      }
      if (latitude < -85.05112878 || latitude > 85.05112878) {
        throw new Error('ERR invalid latitude,valid range is [-85.05112878,85.05112878]');
      }
    }

    if (!this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key)) {
      this._ensureZsetKvStoreEntry(key);
    }

    let added = 0;
    let changed = 0;

    const tx = this.db.transaction(() => {
      for (const { longitude, latitude, member } of members) {
        const hash = encodeGeohash(longitude, latitude);
        const existingRow = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
        const existingGeoRow = this.db.prepare('SELECT longitude, latitude FROM geo_store WHERE key = ? AND member = ?').get(key, member) as { longitude: number; latitude: number } | undefined;

        if (existingRow) {
          // Member already exists
          if (options?.nx) continue; // NX: only add new members
          if (options?.xx) {
            // XX: only update existing members
            if (existingRow.score !== hash) {
              changed++;
            }
            this.db.prepare('UPDATE zset_store SET score = ? WHERE key = ? AND member = ?').run(hash, key, member);
            this.db.prepare('INSERT OR REPLACE INTO geo_store (key, member, longitude, latitude) VALUES (?, ?, ?, ?)').run(key, member, longitude, latitude);
          } else {
            // Default: update
            if (existingRow.score !== hash) {
              changed++;
            }
            // Also check if coordinates changed even if geohash is the same
            if (existingRow.score === hash && existingGeoRow &&
                (existingGeoRow.longitude !== longitude || existingGeoRow.latitude !== latitude)) {
              changed++;
            }
            this.db.prepare('UPDATE zset_store SET score = ? WHERE key = ? AND member = ?').run(hash, key, member);
            this.db.prepare('INSERT OR REPLACE INTO geo_store (key, member, longitude, latitude) VALUES (?, ?, ?, ?)').run(key, member, longitude, latitude);
          }
        } else {
          // Member doesn't exist
          if (options?.xx) continue; // XX: only update existing members
          this._ensureZsetKvStoreEntry(key);
          this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(key, member, hash);
          this.db.prepare('INSERT OR REPLACE INTO geo_store (key, member, longitude, latitude) VALUES (?, ?, ?, ?)').run(key, member, longitude, latitude);
          added++;
        }
      }
    });
    tx();

    return options?.ch ? added + changed : added;
  },

async geohash(key: string, members: string[]): Promise<(string | null)[]> {
    this.evictExpired(key);
    this._ensureGeoTypeOrThrow(key);
    const zsetRows = this.db.prepare('SELECT member, score FROM zset_store WHERE key = ?').all(key) as { member: string; score: number }[];
    const zsetMap = new Map(zsetRows.map(r => [r.member, r.score] as [string, number]));

    return members.map(member => {
      const score = zsetMap.get(member);
      if (score === undefined) return null;
      return geohashToString(score);
    });
  },

async geopos(key: string, members: string[]): Promise<(Array<number> | null)[]> {
    this.evictExpired(key);
    this._ensureGeoTypeOrThrow(key);

    return members.map(member => {
      const geoRow = this.db.prepare('SELECT longitude, latitude FROM geo_store WHERE key = ? AND member = ?').get(key, member) as { longitude: number; latitude: number } | undefined;
      if (geoRow) {
        return [geoRow.longitude, geoRow.latitude];
      }
      // Fallback: decode from zset score
      const zsetRow = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
      if (zsetRow) {
        const coords = decodeGeohash(zsetRow.score);
        return [coords.longitude, coords.latitude];
      }
      return null;
    });
  },

async geodist(key: string, member1: string, member2: string, unit: 'm' | 'km' | 'ft' | 'mi' = 'm'): Promise<number | null> {
    this.evictExpired(key);
    this._ensureGeoTypeOrThrow(key);

    const getCoords = (member: string): { longitude: number; latitude: number } | null => {
      const geoRow = this.db.prepare('SELECT longitude, latitude FROM geo_store WHERE key = ? AND member = ?').get(key, member) as { longitude: number; latitude: number } | undefined;
      if (geoRow) return geoRow;
      const zsetRow = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
      if (zsetRow) return decodeGeohash(zsetRow.score);
      return null;
    };

    const coord1 = getCoords(member1);
    const coord2 = getCoords(member2);
    if (!coord1 || !coord2) return null;

    return calculateDistance(coord1.longitude, coord1.latitude, coord2.longitude, coord2.latitude, unit);
  },

async georadius(key: string, longitude: number, latitude: number, radius: number, unit: 'm' | 'km' | 'ft' | 'mi', options?: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string }): Promise<GeoSearchResult[]> {
    this.evictExpired(key);
    this._ensureGeoTypeOrThrow(key);

    const radiusMeters = radius * this._unitToMeters(unit);
    const sort = options?.sort ?? 'ASC';

    // Get bounding box for initial SQL filter
    const bbox = getBoundingBox(longitude, latitude, radiusMeters);

    // Query geo_store + zset_store with bounding box filter
    const rows = this.db.prepare(
      'SELECT g.member, g.longitude, g.latitude, z.score FROM geo_store g JOIN zset_store z ON g.key = z.key AND g.member = z.member WHERE g.key = ? AND g.longitude BETWEEN ? AND ? AND g.latitude BETWEEN ? AND ?'
    ).all(key, bbox.minLon, bbox.maxLon, bbox.minLat, bbox.maxLat) as { member: string; longitude: number; latitude: number; score: number }[];

    // Filter with isInRadius for circular precision and build results
    let results: GeoSearchResult[] = [];
    for (const row of rows) {
      if (!isInRadius(longitude, latitude, radiusMeters, row.longitude, row.latitude)) continue;

      const result: GeoSearchResult = { member: row.member, score: row.score };
      if (options?.withDist) {
        result.distance = calculateDistance(longitude, latitude, row.longitude, row.latitude, unit);
      }
      if (options?.withCoord) {
        result.longitude = row.longitude;
        result.latitude = row.latitude;
      }
      if (options?.withHash) {
        result.geohash = geohashToString(row.score);
      }
      results.push(result);
    }

    // Sort by distance
    results.sort((a, b) => {
      const distA = calculateDistance(longitude, latitude,
        this._getGeoCoords(key, a.member)!.longitude, this._getGeoCoords(key, a.member)!.latitude, 'm');
      const distB = calculateDistance(longitude, latitude,
        this._getGeoCoords(key, b.member)!.longitude, this._getGeoCoords(key, b.member)!.latitude, 'm');
      return sort === 'ASC' ? distA - distB : distB - distA;
    });

    // Apply count
    if (options?.count !== undefined) {
      results = results.slice(0, options.count);
    }

    // Handle store/storeDist
    if (options?.store) {
      const destKey = options.store;
      this.evictExpired(destKey);
      this._ensureZsetKvStoreEntry(destKey);
      const tx = this.db.transaction(() => {
        this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destKey);
        this.db.prepare('DELETE FROM geo_store WHERE key = ?').run(destKey);
        for (const r of results) {
          this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destKey, r.member, r.score);
          const coords = this._getGeoCoords(key, r.member)!;
          this.db.prepare('INSERT OR REPLACE INTO geo_store (key, member, longitude, latitude) VALUES (?, ?, ?, ?)').run(destKey, r.member, coords.longitude, coords.latitude);
        }
      });
      tx();
    }

    if (options?.storeDist) {
      const destKey = options.storeDist;
      this.evictExpired(destKey);
      this._ensureZsetKvStoreEntry(destKey);
      const tx = this.db.transaction(() => {
        this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destKey);
        for (const r of results) {
          const dist = r.distance ?? calculateDistance(longitude, latitude,
            this._getGeoCoords(key, r.member)!.longitude, this._getGeoCoords(key, r.member)!.latitude, unit);
          this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destKey, r.member, dist);
        }
      });
      tx();
    }

    return results;
  },

async georadiusbymember(key: string, member: string, radius: number, unit: 'm' | 'km' | 'ft' | 'mi', options?: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string }): Promise<GeoSearchResult[]> {
    this.evictExpired(key);
    this._ensureGeoTypeOrThrow(key);

    const coords = this._getGeoCoords(key, member);
    if (!coords) return [];

    return this.georadius(key, coords.longitude, coords.latitude, radius, unit, options);
  },

async geosearch(key: string, options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; withCoord?: boolean; withDist?: boolean; withHash?: boolean }): Promise<GeoSearchResult[]> {
    this.evictExpired(key);
    this._ensureGeoTypeOrThrow(key);

    // Determine center point
    let centerLon: number;
    let centerLat: number;

    if (options.fromMember) {
      const coords = this._getGeoCoords(key, options.fromMember);
      if (!coords) return [];
      centerLon = coords.longitude;
      centerLat = coords.latitude;
    } else {
      centerLon = options.fromLongitude ?? 0;
      centerLat = options.fromLatitude ?? 0;
    }

    let results: GeoSearchResult[] = [];

    if (options.byRadius) {
      const radiusMeters = options.byRadius.radius * this._unitToMeters(options.byRadius.unit);
      const bbox = getBoundingBox(centerLon, centerLat, radiusMeters);

      const rows = this.db.prepare(
        'SELECT g.member, g.longitude, g.latitude, z.score FROM geo_store g JOIN zset_store z ON g.key = z.key AND g.member = z.member WHERE g.key = ? AND g.longitude BETWEEN ? AND ? AND g.latitude BETWEEN ? AND ?'
      ).all(key, bbox.minLon, bbox.maxLon, bbox.minLat, bbox.maxLat) as { member: string; longitude: number; latitude: number; score: number }[];

      for (const row of rows) {
        if (!isInRadius(centerLon, centerLat, radiusMeters, row.longitude, row.latitude)) continue;

        const result: GeoSearchResult = { member: row.member, score: row.score };
        if (options.withDist) {
          result.distance = calculateDistance(centerLon, centerLat, row.longitude, row.latitude, options.byRadius.unit);
        }
        if (options.withCoord) {
          result.longitude = row.longitude;
          result.latitude = row.latitude;
        }
        if (options.withHash) {
          result.geohash = geohashToString(row.score);
        }
        results.push(result);
      }
    } else if (options.byBox) {
      const widthMeters = options.byBox.width * this._unitToMeters(options.byBox.unit);
      const heightMeters = options.byBox.height * this._unitToMeters(options.byBox.unit);
      const halfHeightM = heightMeters / 2;
      const halfWidthM = widthMeters / 2;

      const latDegPerM = 1 / 110540;
      const lonDegPerM = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));
      const bbox = {
        minLon: centerLon - halfWidthM * lonDegPerM,
        maxLon: centerLon + halfWidthM * lonDegPerM,
        minLat: centerLat - halfHeightM * latDegPerM,
        maxLat: centerLat + halfHeightM * latDegPerM,
      };

      const rows = this.db.prepare(
        'SELECT g.member, g.longitude, g.latitude, z.score FROM geo_store g JOIN zset_store z ON g.key = z.key AND g.member = z.member WHERE g.key = ? AND g.longitude BETWEEN ? AND ? AND g.latitude BETWEEN ? AND ?'
      ).all(key, bbox.minLon, bbox.maxLon, bbox.minLat, bbox.maxLat) as { member: string; longitude: number; latitude: number; score: number }[];

      for (const row of rows) {
        const result: GeoSearchResult = { member: row.member, score: row.score };
        if (options.withDist) {
          result.distance = calculateDistance(centerLon, centerLat, row.longitude, row.latitude, options.byBox.unit);
        }
        if (options.withCoord) {
          result.longitude = row.longitude;
          result.latitude = row.latitude;
        }
        if (options.withHash) {
          result.geohash = geohashToString(row.score);
        }
        results.push(result);
      }
    } else {
      return [];
    }

    // Sort by distance
    const sort = options.sort ?? 'ASC';
    results.sort((a, b) => {
      const distA = calculateDistance(centerLon, centerLat,
        this._getGeoCoords(key, a.member)!.longitude, this._getGeoCoords(key, a.member)!.latitude, 'm');
      const distB = calculateDistance(centerLon, centerLat,
        this._getGeoCoords(key, b.member)!.longitude, this._getGeoCoords(key, b.member)!.latitude, 'm');
      return sort === 'ASC' ? distA - distB : distB - distA;
    });

    // Apply count
    if (options.count !== undefined) {
      results = results.slice(0, options.count);
    }

    return results;
  },

async geosearchstore(destination: string, source: string, options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; storeDist?: boolean }): Promise<number> {
    this.evictExpired(destination);
    this.evictExpired(source);

    const searchResults = await this.geosearch(source, {
      fromMember: options.fromMember,
      fromLongitude: options.fromLongitude,
      fromLatitude: options.fromLatitude,
      byRadius: options.byRadius,
      byBox: options.byBox,
      sort: options.sort,
      count: options.count,
      any: options.any,
      withDist: options.storeDist, // Need distance for storeDist
      withCoord: true, // Need coordinates for geoStore
    });

    if (searchResults.length === 0) {
      // Clean up destination if it exists as zset
      const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(destination) as { type: string } | undefined;
      if (typeRow && typeRow.type === 'zset') {
        this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
        this.db.prepare('DELETE FROM geo_store WHERE key = ?').run(destination);
        this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destination);
      }
      return 0;
    }

    // Create/update destination zset
    this._ensureZsetKvStoreEntry(destination);

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM zset_store WHERE key = ?').run(destination);
      this.db.prepare('DELETE FROM geo_store WHERE key = ?').run(destination);

      for (const r of searchResults) {
        if (options.storeDist) {
          const dist = r.distance ?? 0;
          this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, r.member, dist);
        } else {
          this.db.prepare('INSERT OR REPLACE INTO zset_store (key, member, score) VALUES (?, ?, ?)').run(destination, r.member, r.score);
        }
        // Store coordinates in geo_store
        if (r.longitude !== undefined && r.latitude !== undefined) {
          this.db.prepare('INSERT OR REPLACE INTO geo_store (key, member, longitude, latitude) VALUES (?, ?, ?, ?)').run(destination, r.member, r.longitude, r.latitude);
        } else {
          // Fallback to source geo_store lookup
          const srcGeo = this.db.prepare('SELECT longitude, latitude FROM geo_store WHERE key = ? AND member = ?').get(source, r.member) as { longitude: number; latitude: number } | undefined;
          if (srcGeo) {
            this.db.prepare('INSERT OR REPLACE INTO geo_store (key, member, longitude, latitude) VALUES (?, ?, ?, ?)').run(destination, r.member, srcGeo.longitude, srcGeo.latitude);
          }
        }
      }
    });
    tx();

    return searchResults.length;
  },

_getGeoCoords(key: string, member: string): { longitude: number; latitude: number } | null {
    const geoRow = this.db.prepare('SELECT longitude, latitude FROM geo_store WHERE key = ? AND member = ?').get(key, member) as { longitude: number; latitude: number } | undefined;
    if (geoRow) return geoRow;
    const zsetRow = this.db.prepare('SELECT score FROM zset_store WHERE key = ? AND member = ?').get(key, member) as { score: number } | undefined;
    if (zsetRow) return decodeGeohash(zsetRow.score);
    return null;
  },

};
