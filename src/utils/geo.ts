// Geospatial utility functions for GEO commands
// Provides geohash encoding/decoding, distance calculation,
// bounding box computation, and radius checking.

export interface GeoSearchResult {
  member: string;
  distance?: number;      // in requested unit
  longitude?: number;
  latitude?: number;
  geohash?: string;
  score: number;          // the 52-bit geohash score from ZSet
}

const LAT_MIN = -85.05112878;
const LAT_MAX = 85.05112878;
const LON_MIN = -180;
const LON_MAX = 180;

/** Encode a (longitude, latitude) pair into a 52-bit integer geohash. */
export function encodeGeohash(longitude: number, latitude: number): number {
  if (longitude < LON_MIN || longitude > LON_MAX) {
    throw new Error(`ERR invalid longitude, valid range is [${LON_MIN}, ${LON_MAX}]`);
  }
  if (latitude < LAT_MIN || latitude > LAT_MAX) {
    throw new Error(`ERR invalid latitude, valid range is [${LAT_MIN}, ${LAT_MAX}]`);
  }

  let lonRange: [number, number] = [LON_MIN, LON_MAX];
  let latRange: [number, number] = [LAT_MIN, LAT_MAX];

  let hash = 0;

  for (let i = 0; i < 52; i++) {
    hash *= 2; // shift left
    if (i % 2 === 0) {
      // Longitude bit
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (longitude >= mid) {
        hash += 1;
        lonRange = [mid, lonRange[1]];
      } else {
        lonRange = [lonRange[0], mid];
      }
    } else {
      // Latitude bit
      const mid = (latRange[0] + latRange[1]) / 2;
      if (latitude >= mid) {
        hash += 1;
        latRange = [mid, latRange[1]];
      } else {
        latRange = [latRange[0], mid];
      }
    }
  }

  return hash;
}

/** Decode a 52-bit geohash back to approximate (longitude, latitude). */
export function decodeGeohash(hash: number): { longitude: number; latitude: number } {
  let lonRange: [number, number] = [LON_MIN, LON_MAX];
  let latRange: [number, number] = [LAT_MIN, LAT_MAX];

  for (let i = 0; i < 52; i++) {
    // Extract bit at position (51 - i) using arithmetic
    const bit = Math.floor(hash / Math.pow(2, 51 - i)) % 2;

    if (i % 2 === 0) {
      // Longitude bit
      const mid = (lonRange[0] + lonRange[1]) / 2;
      if (bit) {
        lonRange = [mid, lonRange[1]];
      } else {
        lonRange = [lonRange[0], mid];
      }
    } else {
      // Latitude bit
      const mid = (latRange[0] + latRange[1]) / 2;
      if (bit) {
        latRange = [mid, latRange[1]];
      } else {
        latRange = [latRange[0], mid];
      }
    }
  }

  return {
    longitude: (lonRange[0] + lonRange[1]) / 2,
    latitude: (latRange[0] + latRange[1]) / 2,
  };
}

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Convert a 52-bit geohash integer to its base-32 GeoHash string (11 chars). */
export function geohashToString(hash: number): string {
  // 52 bits of geohash. To produce a geohash string, we need to extract
  // 5-bit groups from MSB. 11 groups × 5 bits = 55 bits, so we prepend 
  // 3 zero bits, effectively working with (hash) as bits 51..0.
  // 
  // The geohash string representation takes 5-bit groups starting from MSB:
  // Group 0: bits 54-50 (3 zero padding bits + top 2 bits of hash)  
  // Group 1: bits 49-45
  // ... etc
  // Group 10: bits 4-0

  let result = '';
  for (let group = 0; group < 11; group++) {
    // Calculate the bit positions of this 5-bit group
    // Bits are numbered 54 (MSB) down to 0 (LSB)
    // Hash bits are 51..0, with 3 leading zeros for bits 54,53,52
    const highBit = 54 - group * 5;
    // lowBit = highBit - 4

    let charVal = 0;
    for (let b = 0; b < 5; b++) {
      const bitPos = highBit - b; // bit position: 54 down to 0
      charVal *= 2;
      if (bitPos <= 51) {
        // This is a hash bit
        charVal += Math.floor(hash / Math.pow(2, bitPos)) % 2;
      }
      // bitPos 54, 53, 52 are padding zeros, so charVal gets 0 for those
    }
    result += GEOHASH_BASE32[charVal];
  }
  return result;
}

/** Haversine formula for great-circle distance between two points. */
export function calculateDistance(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
  unit: 'm' | 'km' | 'ft' | 'mi' = 'm'
): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  let R: number;
  switch (unit) {
    case 'km': R = 6371; break;
    case 'ft': R = 20902200; break;
    case 'mi': R = 3963; break;
    case 'm':
    default: R = 6370986; break;
  }

  const d = R * c;
  return Math.round(d * 10000) / 10000;
}

/** Compute bounding box for a radius search around a point. */
export function getBoundingBox(
  longitude: number, latitude: number, radiusMeters: number
): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
  const toRad = (deg: number) => deg * Math.PI / 180;

  const latRad = toRad(latitude);

  // Latitude delta
  const latDelta = radiusMeters / 110540;
  // Longitude delta depends on latitude
  const lonDelta = radiusMeters / (111320 * Math.cos(latRad));

  const minLat = Math.max(LAT_MIN, latitude - latDelta);
  const maxLat = Math.min(LAT_MAX, latitude + latDelta);
  const minLon = Math.max(LON_MIN, longitude - lonDelta);
  const maxLon = Math.min(LON_MAX, longitude + lonDelta);

  return { minLon, maxLon, minLat, maxLat };
}

/** Check if a point is within the radius of a center point. */
export function isInRadius(
  centerLon: number, centerLat: number, radiusMeters: number,
  pointLon: number, pointLat: number
): boolean {
  return calculateDistance(centerLon, centerLat, pointLon, pointLat, 'm') <= radiusMeters;
}

/** Convert a distance in the given unit to meters. */
export function convertToMeters(distance: number, unit: 'm' | 'km' | 'ft' | 'mi'): number {
  switch (unit) {
    case 'km': return distance * 1000;
    case 'ft': return distance * 0.3048;
    case 'mi': return distance * 1609.34;
    case 'm':
    default: return distance;
  }
}

/** Convert a distance in meters to the given unit. */
export function convertFromMeters(distanceMeters: number, unit: 'm' | 'km' | 'ft' | 'mi'): number {
  switch (unit) {
    case 'km': return distanceMeters / 1000;
    case 'ft': return distanceMeters / 0.3048;
    case 'mi': return distanceMeters / 1609.34;
    case 'm':
    default: return distanceMeters;
  }
}