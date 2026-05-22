// @ts-nocheck
import { assertType, assertTypeOneOf, WRONGTYPE_ERROR } from '../type-check';
import type { SqliteStorage } from './core';

export const bitmapMethods = {
_sqliteStringToBytes(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) { bytes.push(str.charCodeAt(i)); }
    return bytes;
  },

_sqliteBytesToString(bytes: number[]): string { return String.fromCharCode(...bytes); },

_sqliteGetBitAt(bytes: number[], offset: number): 0 | 1 {
    const byteIndex = Math.floor(offset / 8);
    const bitIndex = 7 - (offset % 8);
    if (byteIndex >= bytes.length) return 0;
    return ((bytes[byteIndex] >> bitIndex) & 1) as 0 | 1;
  },

_sqliteSetBitAt(bytes: number[], offset: number, value: 0 | 1): 0 | 1 {
    const byteIndex = Math.floor(offset / 8);
    const bitIndex = 7 - (offset % 8);
    while (bytes.length <= byteIndex) bytes.push(0);
    const oldVal = (bytes[byteIndex] >> bitIndex) & 1;
    if (value === 1) { bytes[byteIndex] |= (1 << bitIndex); } else { bytes[byteIndex] &= ~(1 << bitIndex); }
    return oldVal as 0 | 1;
  },

_ensureStringTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'string') throw new Error(WRONGTYPE_ERROR);
  },

async setbit(key: string, offset: number, value: 0 | 1): Promise<number> {
    this.evictExpired(key);
    this._ensureStringTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    let current: string;
    let existingExpiresAt: number | null;
    if (!row) { current = ''; existingExpiresAt = null; }
    else { current = row.value; existingExpiresAt = row.expires_at; }
    const bytes = this._sqliteStringToBytes(current);
    const oldBit = this._sqliteSetBitAt(bytes, offset, value);
    const newValue = this._sqliteBytesToString(bytes);
    this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', ?)").run(key, newValue, existingExpiresAt);
    return oldBit;
  },

async getbit(key: string, offset: number): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return 0;
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (typeRow && typeRow.type !== 'string') throw new Error(WRONGTYPE_ERROR);
    const bytes = this._sqliteStringToBytes(row.value);
    return this._sqliteGetBitAt(bytes, offset);
  },

async bitcount(key: string, start?: number, end?: number): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return 0;
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (typeRow && typeRow.type !== 'string') throw new Error(WRONGTYPE_ERROR);
    const bytes = this._sqliteStringToBytes(row.value);
    if (bytes.length === 0) return 0;
    let s = start ?? 0, e = end ?? -1;
    if (s < 0) s = Math.max(bytes.length + s, 0);
    if (e < 0) e = bytes.length + e;
    if (s > e || s >= bytes.length) return 0;
    if (e >= bytes.length) e = bytes.length - 1;
    let count = 0;
    for (let i = s; i <= e; i++) { let b = bytes[i]; while (b) { count += b & 1; b >>= 1; } }
    return count;
  },

async bitpos(key: string, bit: 0 | 1, start?: number, end?: number): Promise<number> {
    this.evictExpired(key);
    const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return bit === 0 ? 0 : -1;
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (typeRow && typeRow.type !== 'string') throw new Error(WRONGTYPE_ERROR);
    const bytes = this._sqliteStringToBytes(row.value);
    if (bytes.length === 0) return bit === 0 ? 0 : -1;
    let s = start ?? 0, e = end ?? bytes.length - 1;
    if (s < 0) s = Math.max(bytes.length + s, 0);
    if (e < 0) e = bytes.length + e;
    if (s > e || s >= bytes.length) return -1;
    if (e >= bytes.length) e = bytes.length - 1;
    for (let i = s; i <= e; i++) {
      for (let j = 7; j >= 0; j--) {
        const b = (bytes[i] >> j) & 1;
        if (b === bit) return i * 8 + (7 - j);
      }
    }
    return -1;
  },

async bitop(operation: 'AND' | 'OR' | 'XOR' | 'NOT', destkey: string, keys: string[]): Promise<number> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) {
      const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
      if (typeRow && typeRow.type !== 'string') throw new Error(WRONGTYPE_ERROR);
    }
    const srcArrays: number[][] = [];
    for (const key of keys) {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      srcArrays.push(row ? this._sqliteStringToBytes(row.value) : []);
    }
    let maxLen = 0;
    for (const arr of srcArrays) { if (arr.length > maxLen) maxLen = arr.length; }
    if (operation === 'NOT') {
      if (keys.length !== 1) throw new Error('ERR BITOP NOT must have exactly one source key');
      const src = srcArrays[0];
      const result: number[] = [];
      for (let i = 0; i < src.length; i++) result.push((~src[i]) & 0xFF);
      const resultStr = this._sqliteBytesToString(result);
      this.evictExpired(destkey);
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)").run(destkey, resultStr);
      return result.length;
    }
    if (keys.length === 0) { this.evictExpired(destkey); this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(destkey); return 0; }
    const result: number[] = new Array(maxLen).fill(0);
    for (let i = 0; i < maxLen; i++) {
      if (operation === 'AND') { let val = 0xFF; for (const arr of srcArrays) val &= (i < arr.length ? arr[i] : 0); result[i] = val; }
      else if (operation === 'OR') { let val = 0; for (const arr of srcArrays) val |= (i < arr.length ? arr[i] : 0); result[i] = val; }
      else if (operation === 'XOR') { let val = 0; for (const arr of srcArrays) val ^= (i < arr.length ? arr[i] : 0); result[i] = val; }
    }
    const resultStr = this._sqliteBytesToString(result);
    this.evictExpired(destkey);
    this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'string', NULL)").run(destkey, resultStr);
    return result.length;
  },

async bitfield(key: string, operations: Array<{ type: 'GET' | 'SET' | 'INCRBY'; encoding: string; offset: number; value?: number; overflow?: 'WRAP' | 'SAT' | 'FAIL' }>): Promise<(number | null)[]> {
    this.evictExpired(key);
    this._ensureStringTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    let current: string;
    let existingExpiresAt: number | null;
    if (!row) { current = ''; existingExpiresAt = null; } else { current = row.value; existingExpiresAt = row.expires_at; }
    const bytes = this._sqliteStringToBytes(current);
    const results: (number | null)[] = [];
    let currentOverflow: 'WRAP' | 'SAT' | 'FAIL' = 'WRAP';

    for (const op of operations) {
      if (op.type !== 'GET' && op.overflow) currentOverflow = op.overflow;
      const isSigned = op.encoding.toLowerCase().startsWith('i');
      const bits = parseInt(op.encoding.slice(1));
      if (bits < 1 || bits > 64) throw new Error('ERR invalid bitfield encoding');
      const maxUnsigned = Math.pow(2, bits) - 1;
      const maxSigned = Math.pow(2, bits - 1) - 1;
      const minSigned = -Math.pow(2, bits - 1);

      const applyOverflow = (val: number): number | null => {
        if (isSigned) {
          if (val > maxSigned || val < minSigned) {
            if (currentOverflow === 'FAIL') return null;
            if (currentOverflow === 'SAT') return val > maxSigned ? maxSigned : val < minSigned ? minSigned : val;
            const range = Math.pow(2, bits);
            return ((val + Math.pow(2, bits - 1)) % range + range) % range - Math.pow(2, bits - 1);
          }
          return val;
        } else {
          if (val < 0 || val > maxUnsigned) {
            if (currentOverflow === 'FAIL') return null;
            if (currentOverflow === 'SAT') return val < 0 ? 0 : val > maxUnsigned ? maxUnsigned : val;
            return ((val % (maxUnsigned + 1)) + (maxUnsigned + 1)) % (maxUnsigned + 1);
          }
          return val;
        }
      };

      if (op.type === 'GET') {
        let val = 0;
        for (let b = 0; b < bits; b++) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          if (byteIdx < bytes.length) val = (val << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
          else val = val << 1;
        }
        if (isSigned && val > maxSigned) val = val - Math.pow(2, bits);
        results.push(val);
      } else if (op.type === 'SET') {
        let oldVal = 0;
        for (let b = 0; b < bits; b++) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          if (byteIdx < bytes.length) oldVal = (oldVal << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
        }
        if (isSigned && oldVal > maxSigned) oldVal = oldVal - Math.pow(2, bits);
        const setValue = op.value!;
        let writeVal = isSigned ? (setValue < 0 ? setValue + Math.pow(2, bits) : setValue) : (setValue < 0 ? setValue + Math.pow(2, bits) : setValue);
        for (let b = bits - 1; b >= 0; b--) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          while (bytes.length <= byteIdx) bytes.push(0);
          const bit = (writeVal >> (bits - 1 - b)) & 1;
          if (bit === 1) bytes[byteIdx] |= (1 << bitIdx);
          else bytes[byteIdx] &= ~(1 << bitIdx);
        }
        results.push(oldVal);
      } else if (op.type === 'INCRBY') {
        let currentVal = 0;
        for (let b = 0; b < bits; b++) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          if (byteIdx < bytes.length) currentVal = (currentVal << 1) | ((bytes[byteIdx] >> bitIdx) & 1);
        }
        if (isSigned && currentVal > maxSigned) currentVal = currentVal - Math.pow(2, bits);
        const increment = op.value!;
        const newVal = currentVal + increment;
        const clampedVal = applyOverflow(newVal);
        if (clampedVal === null) { results.push(null); continue; }
        let writeVal = isSigned ? (clampedVal < 0 ? clampedVal + Math.pow(2, bits) : clampedVal) : clampedVal;
        for (let b = bits - 1; b >= 0; b--) {
          const bitPos = op.offset + b;
          const byteIdx = Math.floor(bitPos / 8);
          const bitIdx = 7 - (bitPos % 8);
          while (bytes.length <= byteIdx) bytes.push(0);
          const bit = (writeVal >> (bits - 1 - b)) & 1;
          if (bit === 1) bytes[byteIdx] |= (1 << bitIdx);
          else bytes[byteIdx] &= ~(1 << bitIdx);
        }
        results.push(clampedVal);
      }
    }
    const newValue = this._sqliteBytesToString(bytes);
    this.db.prepare('INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, \'string\', ?)').run(key, newValue, existingExpiresAt);
    return results;
  },

async bitfieldRo(key: string, operations: Array<{ type: 'GET'; encoding: string; offset: number }>): Promise<(number | null)[]> {
    const opsWithOverflow: Array<{ type: 'GET' | 'SET' | 'INCRBY'; encoding: string; offset: number; value?: number; overflow?: 'WRAP' | 'SAT' | 'FAIL' }> = operations.map(op => ({ ...op, overflow: 'WRAP' as const }));
    return this.bitfield(key, opsWithOverflow);
  },

};
