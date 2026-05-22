// @ts-nocheck
import type { InMemoryStorage } from './core';
import { encodeGeohash, decodeGeohash, geohashToString, calculateDistance, getBoundingBox, isInRadius } from '../../utils/geo';
import type { GeoSearchResult } from '../../utils/geo';

export const geoMethods = {
_ensureGeoTypeOrThrow(key: string): void {
    const entry = this.store.get(key);
    if (entry && entry.type !== 'zset') {
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
    this.evictIfExpired(key);
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

    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'zset', expiresAt: null });
    }
    if (!this.zsetStore.has(key)) {
      this.zsetStore.set(key, new Map());
    }
    if (!this.geoStore.has(key)) {
      this.geoStore.set(key, new Map());
    }

    const zset = this.zsetStore.get(key)!;
    const geoData = this.geoStore.get(key)!;
    let added = 0;
    let changed = 0;

    for (const { longitude, latitude, member } of members) {
      const hash = encodeGeohash(longitude, latitude);

      if (zset.has(member)) {
        // Member already exists
        if (options?.nx) continue; // NX: only add new members
        if (options?.xx) {
          // XX: only update existing members
          const oldScore = zset.get(member)!;
          if (oldScore !== hash) {
            changed++;
          }
          zset.set(member, hash);
          geoData.set(member, { longitude, latitude });
        } else {
          // Default: update
          const oldScore = zset.get(member)!;
          if (oldScore !== hash) {
            changed++;
          }
          zset.set(member, hash);
          geoData.set(member, { longitude, latitude });
        }
      } else {
        // Member doesn't exist
        if (options?.xx) continue; // XX: only update existing members
        zset.set(member, hash);
        geoData.set(member, { longitude, latitude });
        added++;
      }
    }

    return options?.ch ? added + changed : added;
  },

async geohash(key: string, members: string[]): Promise<(string | null)[]> {
    this.evictIfExpired(key);
    this._ensureGeoTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    if (!zset) {
      return members.map(() => null);
    }
    return members.map(member => {
      const score = zset.get(member);
      if (score === undefined) return null;
      return geohashToString(score);
    });
  },

async geopos(key: string, members: string[]): Promise<(Array<number> | null)[]> {
    this.evictIfExpired(key);
    this._ensureGeoTypeOrThrow(key);
    const geoData = this.geoStore.get(key);
    const zset = this.zsetStore.get(key);
    return members.map(member => {
      // Try geoStore first
      if (geoData && geoData.has(member)) {
        const { longitude, latitude } = geoData.get(member)!;
        return [longitude, latitude];
      }
      // Fallback: decode from score
      if (zset && zset.has(member)) {
        const score = zset.get(member)!;
        const { longitude, latitude } = decodeGeohash(score);
        return [longitude, latitude];
      }
      return null;
    });
  },

async geodist(key: string, member1: string, member2: string, unit: 'm' | 'km' | 'ft' | 'mi' = 'm'): Promise<number | null> {
    this.evictIfExpired(key);
    this._ensureGeoTypeOrThrow(key);
    const geoData = this.geoStore.get(key);
    const zset = this.zsetStore.get(key);
    if (!zset) return null;

    const getCoords = (member: string): { longitude: number; latitude: number } | null => {
      if (geoData && geoData.has(member)) {
        return geoData.get(member)!;
      }
      if (zset.has(member)) {
        return decodeGeohash(zset.get(member)!);
      }
      return null;
    };

    const coord1 = getCoords(member1);
    const coord2 = getCoords(member2);
    if (!coord1 || !coord2) return null;

    return calculateDistance(coord1.longitude, coord1.latitude, coord2.longitude, coord2.latitude, unit);
  },

async georadius(key: string, longitude: number, latitude: number, radius: number, unit: 'm' | 'km' | 'ft' | 'mi', options?: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string }): Promise<GeoSearchResult[]> {
    this.evictIfExpired(key);
    this._ensureGeoTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    const geoData = this.geoStore.get(key);
    if (!zset || zset.size === 0) return [];

    const radiusMeters = radius * this._unitToMeters(unit);
    const sort = options?.sort ?? 'ASC';

    const getCoords = (member: string): { longitude: number; latitude: number } | null => {
      if (geoData && geoData.has(member)) {
        return geoData.get(member)!;
      }
      if (zset.has(member)) {
        return decodeGeohash(zset.get(member)!);
      }
      return null;
    };

    // Filter within bounding box then radius
    const bbox = getBoundingBox(longitude, latitude, radiusMeters);
    let results: GeoSearchResult[] = [];

    for (const [member, score] of zset) {
      const coords = getCoords(member);
      if (!coords) continue;

      // Bounding box pre-filter
      if (coords.longitude < bbox.minLon || coords.longitude > bbox.maxLon ||
          coords.latitude < bbox.minLat || coords.latitude > bbox.maxLat) continue;

      // Accurate radius check
      if (!isInRadius(longitude, latitude, radiusMeters, coords.longitude, coords.latitude)) continue;

      const result: GeoSearchResult = { member, score };
      if (options?.withDist) {
        result.distance = calculateDistance(longitude, latitude, coords.longitude, coords.latitude, unit);
      }
      if (options?.withCoord) {
        result.longitude = coords.longitude;
        result.latitude = coords.latitude;
      }
      if (options?.withHash) {
        result.geohash = geohashToString(score);
      }
      results.push(result);
    }

    // Sort by distance from center
    results.sort((a, b) => {
      const distA = calculateDistance(longitude, latitude,
        getCoords(a.member)!.longitude, getCoords(a.member)!.latitude, 'm');
      const distB = calculateDistance(longitude, latitude,
        getCoords(b.member)!.longitude, getCoords(b.member)!.latitude, 'm');
      return sort === 'ASC' ? distA - distB : distB - distA;
    });

    // Apply count
    if (options?.count !== undefined) {
      results = results.slice(0, options.count);
    }

    // Handle store/storeDist
    if (options?.store) {
      this.evictIfExpired(options.store);
      this._ensureGeoTypeOrThrow(options.store);
      if (!this.store.has(options.store)) {
        this.store.set(options.store, { value: '', type: 'zset', expiresAt: null });
      }
      if (!this.zsetStore.has(options.store)) {
        this.zsetStore.set(options.store, new Map());
      }
      if (!this.geoStore.has(options.store)) {
        this.geoStore.set(options.store, new Map());
      }
      const destZset = this.zsetStore.get(options.store)!;
      const destGeo = this.geoStore.get(options.store)!;
      destZset.clear();
      destGeo.clear();
      for (const r of results) {
        const coords = getCoords(r.member)!;
        destZset.set(r.member, r.score);
        destGeo.set(r.member, coords);
      }
      return results;
    }

    if (options?.storeDist) {
      this.evictIfExpired(options.storeDist!);
      this._ensureGeoTypeOrThrow(options.storeDist!);
      if (!this.store.has(options.storeDist)) {
        this.store.set(options.storeDist, { value: '', type: 'zset', expiresAt: null });
      }
      if (!this.zsetStore.has(options.storeDist)) {
        this.zsetStore.set(options.storeDist, new Map());
      }
      const destZset = this.zsetStore.get(options.storeDist)!;
      destZset.clear();
      for (const r of results) {
        const dist = r.distance ?? calculateDistance(longitude, latitude,
          getCoords(r.member)!.longitude, getCoords(r.member)!.latitude, unit);
        destZset.set(r.member, dist);
      }
      return results;
    }

    return results;
  },

async georadiusbymember(key: string, member: string, radius: number, unit: 'm' | 'km' | 'ft' | 'mi', options?: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string }): Promise<GeoSearchResult[]> {
    this.evictIfExpired(key);
    this._ensureGeoTypeOrThrow(key);
    const geoData = this.geoStore.get(key);
    const zset = this.zsetStore.get(key);
    if (!zset || !zset.has(member)) return [];

    const getCoords = (m: string): { longitude: number; latitude: number } | null => {
      if (geoData && geoData.has(m)) {
        return geoData.get(m)!;
      }
      if (zset.has(m)) {
        return decodeGeohash(zset.get(m)!);
      }
      return null;
    };

    const coords = getCoords(member);
    if (!coords) return [];

    return this.georadius(key, coords.longitude, coords.latitude, radius, unit, options);
  },

async geosearch(key: string, options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; withCoord?: boolean; withDist?: boolean; withHash?: boolean }): Promise<GeoSearchResult[]> {
    this.evictIfExpired(key);
    this._ensureGeoTypeOrThrow(key);
    const zset = this.zsetStore.get(key);
    const geoData = this.geoStore.get(key);
    if (!zset || zset.size === 0) return [];

    // Determine center point
    let centerLon: number;
    let centerLat: number;

    if (options.fromMember) {
      const memberCoords = geoData?.get(options.fromMember) ?? (zset.has(options.fromMember) ? decodeGeohash(zset.get(options.fromMember)!) : null);
      if (!memberCoords) return [];
      centerLon = memberCoords.longitude;
      centerLat = memberCoords.latitude;
    } else {
      centerLon = options.fromLongitude ?? 0;
      centerLat = options.fromLatitude ?? 0;
    }

    const getCoords = (member: string): { longitude: number; latitude: number } | null => {
      if (geoData && geoData.has(member)) {
        return geoData.get(member)!;
      }
      if (zset.has(member)) {
        return decodeGeohash(zset.get(member)!);
      }
      return null;
    };

    let results: GeoSearchResult[] = [];

    if (options.byRadius) {
      const radiusMeters = options.byRadius.radius * this._unitToMeters(options.byRadius.unit);
      const bbox = getBoundingBox(centerLon, centerLat, radiusMeters);

      for (const [member, score] of zset) {
        const coords = getCoords(member);
        if (!coords) continue;
        if (coords.longitude < bbox.minLon || coords.longitude > bbox.maxLon ||
            coords.latitude < bbox.minLat || coords.latitude > bbox.maxLat) continue;
        if (!isInRadius(centerLon, centerLat, radiusMeters, coords.longitude, coords.latitude)) continue;

        const result: GeoSearchResult = { member, score };
        if (options.withDist) {
          result.distance = calculateDistance(centerLon, centerLat, coords.longitude, coords.latitude,
            options.byRadius!.unit);
        }
        if (options.withCoord) {
          result.longitude = coords.longitude;
          result.latitude = coords.latitude;
        }
        if (options.withHash) {
          result.geohash = geohashToString(score);
        }
        results.push(result);
      }
    } else if (options.byBox) {
      const widthMeters = options.byBox.width * this._unitToMeters(options.byBox.unit);
      const heightMeters = options.byBox.height * this._unitToMeters(options.byBox.unit);
      const halfHeightM = heightMeters / 2;
      const halfWidthM = widthMeters / 2;

      // Compute bounding box
      const latDegPerM = 1 / 110540;
      const lonDegPerM = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));
      const bbox = {
        minLon: centerLon - halfWidthM * lonDegPerM,
        maxLon: centerLon + halfWidthM * lonDegPerM,
        minLat: centerLat - halfHeightM * latDegPerM,
        maxLat: centerLat + halfHeightM * latDegPerM
      };

      for (const [member, score] of zset) {
        const coords = getCoords(member);
        if (!coords) continue;
        if (coords.longitude < bbox.minLon || coords.longitude > bbox.maxLon ||
            coords.latitude < bbox.minLat || coords.latitude > bbox.maxLat) continue;

        const result: GeoSearchResult = { member, score };
        if (options.withDist) {
          result.distance = calculateDistance(centerLon, centerLat, coords.longitude, coords.latitude,
            options.byBox!.unit);
        }
        if (options.withCoord) {
          result.longitude = coords.longitude;
          result.latitude = coords.latitude;
        }
        if (options.withHash) {
          result.geohash = geohashToString(score);
        }
        results.push(result);
      }
    } else {
      return [];
    }

    // Sort
    const sort = options.sort ?? 'ASC';
    results.sort((a, b) => {
      const distA = calculateDistance(centerLon, centerLat,
        getCoords(a.member)!.longitude, getCoords(a.member)!.latitude, 'm');
      const distB = calculateDistance(centerLon, centerLat,
        getCoords(b.member)!.longitude, getCoords(b.member)!.latitude, 'm');
      return sort === 'ASC' ? distA - distB : distB - distA;
    });

    // Apply count
    if (options.count !== undefined) {
      results = results.slice(0, options.count);
    }

    return results;
  },

async geosearchstore(destination: string, source: string, options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; storeDist?: boolean }): Promise<number> {
    this.evictIfExpired(destination);
    this.evictIfExpired(source);

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
      // Clean up or create empty destination
      const destEntry = this.store.get(destination);
      if (destEntry && destEntry.type === 'zset') {
        this.zsetStore.delete(destination);
        this.geoStore.delete(destination);
        this.store.delete(destination);
      }
      return 0;
    }

    // Create/update destination zset
    this._ensureZsetKeyExists(destination);
    const destZset = this.zsetStore.get(destination)!;
    const destGeo = this.geoStore.has(destination) ? this.geoStore.get(destination)! : new Map<string, { longitude: number; latitude: number }>();
    if (!this.geoStore.has(destination)) {
      this.geoStore.set(destination, destGeo);
    }
    destZset.clear();
    destGeo.clear();

    // Need source geoData for coordinate lookup
    const sourceGeoData = this.geoStore.get(source);
    const sourceZset = this.zsetStore.get(source);

    const getSourceCoords = (member: string): { longitude: number; latitude: number } | null => {
      if (sourceGeoData && sourceGeoData.has(member)) {
        return sourceGeoData.get(member)!;
      }
      if (sourceZset && sourceZset.has(member)) {
        return decodeGeohash(sourceZset.get(member)!);
      }
      return null;
    };

    for (const r of searchResults) {
      if (options.storeDist) {
        const dist = r.distance ?? 0;
        destZset.set(r.member, dist);
      } else {
        destZset.set(r.member, r.score);
      }
      const coords = r.longitude !== undefined && r.latitude !== undefined
        ? { longitude: r.longitude, latitude: r.latitude }
        : getSourceCoords(r.member);
      if (coords) {
        destGeo.set(r.member, coords);
      }
    }

    return searchResults.length;
  },

};
