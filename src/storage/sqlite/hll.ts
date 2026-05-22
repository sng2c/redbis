// @ts-nocheck
import type { SqliteStorage } from './core';

const HLL_REGISTERS = 16384;
const HLL_BYTES = 12288;

export const hllMethods = {
_ensureHllTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as { type: string } | undefined;
    if (row && row.type !== 'hyperloglog') throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

  },

_murmurHash64(str: string): bigint {
    let h1 = 0x9e3779b97f4a7c15n;
    for (let i = 0; i < str.length; i++) {
      h1 ^= BigInt(str.charCodeAt(i));
      h1 = (h1 * 0xbf58476d1ce4e5b9n) & 0xFFFFFFFFFFFFFFFFn;
      h1 = ((h1 ^ (h1 >> 31n)) & 0xFFFFFFFFFFFFFFFFn);
    }
    return h1;
  },

_hllIndex(hash: bigint): number { return Number(hash & 0x3FFFn); },

_hllRho(hash: bigint): number {
    const remaining = hash >> 14n;
    if (remaining === 0n) return 51;
    let count = 1;
    let val = remaining;
    while ((val & 1n) === 0n && count < 51) { count++; val >>= 1n; }
    return count;
  },

_hllEncode(registers: Uint8Array): string { return Buffer.from(registers).toString('base64'); },

_hllDecode(data: string): Uint8Array { return new Uint8Array(Buffer.from(data, 'base64')); },

_read6BitRegister(data: Uint8Array, index: number): number {
    const bitOffset = index * 6;
    const byteOffset = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;
    let value = 0, bitsNeeded = 6, currentByte = byteOffset, currentBit = bitInByte;
    while (bitsNeeded > 0) {
      const bitsAvailable = 8 - currentBit;
      const bitsToRead = Math.min(bitsAvailable, bitsNeeded);
      const mask = ((1 << bitsToRead) - 1) << (bitsAvailable - bitsToRead);
      const bits = (data[currentByte] & mask) >> (bitsAvailable - bitsToRead);
      value = (value << bitsToRead) | bits;
      bitsNeeded -= bitsToRead; currentBit = 0; currentByte++;
    }
    return value;
  },

_write6BitRegister(data: Uint8Array, index: number, value: number): void {
    const bitOffset = index * 6;
    const byteOffset = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;
    let bitsToWrite = 6, currentByte = byteOffset, currentBit = bitInByte, shiftedValue = value;
    while (bitsToWrite > 0) {
      const bitsAvailable = 8 - currentBit;
      const bitsToWriteNow = Math.min(bitsAvailable, bitsToWrite);
      const mask = ((1 << bitsToWriteNow) - 1);
      const bits = (shiftedValue >> (bitsToWrite - bitsToWriteNow)) & mask;
      const shift = bitsAvailable - bitsToWriteNow;
      data[currentByte] &= ~(mask << shift);
      data[currentByte] |= (bits << shift);
      bitsToWrite -= bitsToWriteNow; currentBit = 0; currentByte++;
    }
  },

_hllEstimate(registers: Uint8Array): number {
    const m = HLL_REGISTERS;
    let sum = 0, zeros = 0;
    for (let i = 0; i < m; i++) {
      const regVal = this._read6BitRegister(registers, i);
      sum += 1 / Math.pow(2, regVal);
      if (regVal === 0) zeros++;
    }
    const alpha = 0.7213 / (1 + 1.079 / m);
    const estimate = alpha * m * m / sum;
    if (estimate <= 2.5 * m && zeros > 0) return Math.round(m * Math.log(m / zeros));
    return Math.max(0, Math.round(estimate));
  },

async pfadd(key: string, elements: string[]): Promise<number> {
    this.evictExpired(key);
    this._ensureHllTypeOrThrow(key);
    const row = this.db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').get(key) as { value: string; expires_at: number | null } | undefined;
    let registers: Uint8Array;
    let existingExpiresAt: number | null;
    if (!row) { registers = new Uint8Array(HLL_BYTES); existingExpiresAt = null; }
    else { registers = this._hllDecode(row.value); existingExpiresAt = row.expires_at; }
    let changed = false;
    for (const el of elements) {
      const hash = this._murmurHash64(el);
      const idx = this._hllIndex(hash);
      const rho = this._hllRho(hash);
      const currentVal = this._read6BitRegister(registers, idx);
      if (rho > currentVal) { this._write6BitRegister(registers, idx, rho); changed = true; }
    }
    if (changed || !row) {
      this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'hyperloglog', ?)").run(key, this._hllEncode(registers), existingExpiresAt);
    }
    return changed ? 1 : 0;
  },

async pfcount(keys: string[]): Promise<number> {
    for (const key of keys) this.evictExpired(key);
    for (const key of keys) this._ensureHllTypeOrThrow(key);
    if (keys.length === 0) return 0;
    if (keys.length === 1) {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(keys[0]) as { value: string } | undefined;
      if (!row) return 0;
      const registers = this._hllDecode(row.value);
      return this._hllEstimate(registers);
    }
    const merged = new Uint8Array(HLL_BYTES);
    for (const key of keys) {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      if (!row) continue;
      const registers = this._hllDecode(row.value);
      for (let i = 0; i < HLL_REGISTERS; i++) {
        const val = this._read6BitRegister(registers, i);
        const currentVal = this._read6BitRegister(merged, i);
        if (val > currentVal) this._write6BitRegister(merged, i, val);
      }
    }
    return this._hllEstimate(merged);
  },

async pfmerge(destkey: string, sourceKeys: string[]): Promise<void> {
    this.evictExpired(destkey);
    for (const key of sourceKeys) this.evictExpired(key);
    for (const key of sourceKeys) this._ensureHllTypeOrThrow(key);
    this._ensureHllTypeOrThrow(destkey);
    const merged = new Uint8Array(HLL_BYTES);
    for (const key of sourceKeys) {
      const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
      if (!row) continue;
      const registers = this._hllDecode(row.value);
      for (let i = 0; i < HLL_REGISTERS; i++) {
        const val = this._read6BitRegister(registers, i);
        const currentVal = this._read6BitRegister(merged, i);
        if (val > currentVal) this._write6BitRegister(merged, i, val);
      }
    }
    this.db.prepare("INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, ?, 'hyperloglog', NULL)").run(destkey, this._hllEncode(merged));
  },

};
