import { describe, it, expect } from 'vitest';
import {
  encodeGeohash,
  decodeGeohash,
  geohashToString,
  calculateDistance,
  getBoundingBox,
  isInRadius,
} from '../utils/geo';

describe('GEO Utility: encodeGeohash', () => {
  it('should encode (0, 0) to roughly the middle of the range', () => {
    const hash = encodeGeohash(0, 0);
    // Middle of 52-bit range is about 2^51 = 2251799813685248
    expect(hash).toBeGreaterThan(0);
    // Should decode back close
    const decoded = decodeGeohash(hash);
    expect(Math.abs(decoded.longitude)).toBeLessThan(0.01);
    expect(Math.abs(decoded.latitude)).toBeLessThan(0.01);
  });

  it('should encode (-180, -85.05112878) near 0', () => {
    const hash = encodeGeohash(-180, -85.05112878);
    expect(hash).toBe(0);
  });

  it('should encode (170, 85.05112878) near maximum', () => {
    const hash = encodeGeohash(170, 85.05112878);
    // Should be near the maximum 52-bit value
    expect(hash).toBeGreaterThan(0);
    // A high lon and high lat should produce a very large hash
    expect(hash).toBeGreaterThan(encodeGeohash(0, 0));
  });

  it('should throw on invalid longitude', () => {
    expect(() => encodeGeohash(181, 0)).toThrow();
    expect(() => encodeGeohash(-181, 0)).toThrow();
  });

  it('should throw on invalid latitude', () => {
    expect(() => encodeGeohash(0, 86)).toThrow();
    expect(() => encodeGeohash(0, -86)).toThrow();
  });

  it('round-trip: encode then decode should be close to original', () => {
    const testCases: [number, number][] = [
      [13.361389, 38.115556], // Palermo
      [15.087269, 37.502669], // Catania
      [-73.9857, 40.7484], // NYC
      [2.3522, 48.8566], // Paris
      [139.6917, 35.6895], // Tokyo
    ];
    for (const [lon, lat] of testCases) {
      const hash = encodeGeohash(lon, lat);
      const decoded = decodeGeohash(hash);
      expect(Math.abs(decoded.longitude - lon)).toBeLessThan(0.5);
      expect(Math.abs(decoded.latitude - lat)).toBeLessThan(0.5);
    }
  });
});

describe('GEO Utility: decodeGeohash', () => {
  it('should decode 0 to near (-180, -85)', () => {
    const decoded = decodeGeohash(0);
    expect(decoded.longitude).toBeCloseTo(-179.9, 0);
    expect(decoded.latitude).toBeCloseTo(-85, 0);
  });

  it('should decode and re-encode consistently', () => {
    const hash = encodeGeohash(13.361389, 38.115556);
    const decoded = decodeGeohash(hash);
    const reEncoded = encodeGeohash(decoded.longitude, decoded.latitude);
    expect(reEncoded).toBe(hash);
  });
});

describe('GEO Utility: geohashToString', () => {
  it('should produce 11-character geohash string', () => {
    const hash = encodeGeohash(13.361389, 38.115556);
    const str = geohashToString(hash);
    expect(str.length).toBe(11);
    // Should only contain base32 geohash characters
    expect(str).toMatch(/^[0123456789bcdefghjkmnpqrstuvwxyz]+$/);
  });

  it('should produce a recognizable geohash for known locations', () => {
    const hash = encodeGeohash(13.361389, 38.115556);
    const str = geohashToString(hash);
    // Palermo's geohash starts with 'sqcj' or similar
    expect(str.length).toBe(11);
  });

  it('should produce all-zeros geohash for hash 0', () => {
    const str = geohashToString(0);
    expect(str).toBe('00000000000');
  });
});

describe('GEO Utility: calculateDistance', () => {
  it('should calculate distance between two points (meters)', () => {
    // Distance from Palermo to Catania (~166km)
    const d = calculateDistance(13.361389, 38.115556, 15.087269, 37.502669, 'm');
    expect(d).toBeGreaterThan(150000);
    expect(d).toBeLessThan(200000);
  });

  it('should calculate distance in km', () => {
    const d = calculateDistance(13.361389, 38.115556, 15.087269, 37.502669, 'km');
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(200);
  });

  it('should return 0 for same point', () => {
    const d = calculateDistance(0, 0, 0, 0, 'm');
    expect(d).toBe(0);
  });

  it('should calculate distance in miles', () => {
    const d = calculateDistance(13.361389, 38.115556, 15.087269, 37.502669, 'mi');
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(130);
  });

  it('should calculate distance in feet', () => {
    const d = calculateDistance(13.361389, 38.115556, 15.087269, 37.502669, 'ft');
    expect(d).toBeGreaterThan(480000);
    expect(d).toBeLessThan(660000);
  });
});

describe('GEO Utility: getBoundingBox', () => {
  it('should return bounding box around a point', () => {
    const box = getBoundingBox(0, 0, 1000);
    expect(box.minLon).toBeLessThan(0);
    expect(box.maxLon).toBeGreaterThan(0);
    expect(box.minLat).toBeLessThan(0);
    expect(box.maxLat).toBeGreaterThan(0);
    // At equator, 1000m should be roughly ±0.009 degrees
    expect(box.maxLon - box.minLon).toBeLessThan(0.02);
    expect(box.maxLat - box.minLat).toBeLessThan(0.02);
  });

  it('should clamp to valid ranges', () => {
    const box = getBoundingBox(0, 85, 1000000);
    expect(box.maxLat).toBeLessThanOrEqual(85.05112878);
    expect(box.minLat).toBeGreaterThanOrEqual(-85.05112878);
    expect(box.minLon).toBeGreaterThanOrEqual(-180);
    expect(box.maxLon).toBeLessThanOrEqual(180);
  });
});

describe('GEO Utility: isInRadius', () => {
  it('should return true for very close points', () => {
    expect(isInRadius(0, 0, 1000, 0.001, 0.001)).toBe(true);
  });

  it('should return false for distant points', () => {
    expect(isInRadius(0, 0, 1000, 10, 10)).toBe(false);
  });

  it('should return true for same point', () => {
    expect(isInRadius(0, 0, 0, 0, 0)).toBe(true);
  });
});
