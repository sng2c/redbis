// @ts-nocheck
import { assertType } from '../type-check';
import type { InMemoryStorage } from './core';

export const jsonAdvancedMethods = {
  async jsonNumincrby(key: string, path: string, increment: number): Promise<string | null> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, path);
    if (resolved.length === 0) return null;

    for (const r of resolved) {
      if (typeof r.value === 'number') {
        const newVal = r.value + increment;
        if (r.parent !== null) {
          r.parent[r.key] = newVal;
        } else {
          root = newVal;
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    const newResolved = this._jsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'number') {
      return String(newResolved[0].value);
    }
    return null;
  },

  async jsonNummultby(key: string, path: string, multiplier: number): Promise<string | null> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, path);
    if (resolved.length === 0) return null;

    for (const r of resolved) {
      if (typeof r.value === 'number') {
        const newVal = r.value * multiplier;
        if (r.parent !== null) {
          r.parent[r.key] = newVal;
        } else {
          root = newVal;
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    const newResolved = this._jsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'number') {
      return String(newResolved[0].value);
    }
    return null;
  },

  async jsonMget(keys: string[], path: string): Promise<(string | null)[]> {
    const results: (string | null)[] = [];
    for (const key of keys) {
      this.evictIfExpired(key);
      const entry = this.store.get(key);
      if (!entry || entry.type !== 'json') {
        results.push(null);
        continue;
      }
      const root = JSON.parse(entry.value);
      const resolved = this._jsonResolvePath(root, path);
      if (resolved.length === 0) {
        results.push(null);
      } else {
        results.push(JSON.stringify(resolved[0].value));
      }
    }
    return results;
  },

  async jsonMset(pairs: Array<{ key: string; path: string; value: string }>): Promise<void> {
    for (const { key, path, value } of pairs) {
      await this.jsonSet(key, path, value);
    }
  },

  async jsonToggle(key: string, path?: string): Promise<string | null> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    const effectivePath = path || '$';
    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    let result: string | null = null;
    for (const r of resolved) {
      if (typeof r.value === 'boolean') {
        const newVal = !r.value;
        if (r.parent !== null) {
          r.parent[r.key] = newVal;
        } else {
          root = newVal;
        }
        result = String(newVal);
      }
    }

    if (result !== null) {
      this.store.set(key, {
        value: JSON.stringify(root),
        type: 'json',
        expiresAt: entry.expiresAt,
      });
    }
    return result;
  },

  async jsonClear(key: string, path?: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return 0;

    const effectivePath = path || '$';
    let root = JSON.parse(entry.value);
    if (effectivePath === '$' || effectivePath === '') {
      // Clear root
      if (Array.isArray(root)) {
        root = [];
      } else if (typeof root === 'object' && root !== null) {
        root = {};
      } else if (typeof root === 'string') {
        root = '';
      } else if (typeof root === 'number') {
        root = 0;
      }
      this.store.set(key, {
        value: JSON.stringify(root),
        type: 'json',
        expiresAt: entry.expiresAt,
      });
      return 1;
    }

    const resolved = this._jsonResolvePath(root, effectivePath);
    let count = 0;
    for (const r of resolved) {
      if (Array.isArray(r.value)) {
        r.parent[r.key] = [];
        count++;
      } else if (typeof r.value === 'object' && r.value !== null) {
        r.parent[r.key] = {};
        count++;
      } else if (typeof r.value === 'string') {
        r.parent[r.key] = '';
        count++;
      } else if (typeof r.value === 'number') {
        r.parent[r.key] = 0;
        count++;
      }
    }

    if (count > 0) {
      this.store.set(key, {
        value: JSON.stringify(root),
        type: 'json',
        expiresAt: entry.expiresAt,
      });
    }
    return count;
  },

  async jsonDebugMemory(key: string, path?: string): Promise<number | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    assertType(entry.type, 'json');

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';

    if (effectivePath === '$' || effectivePath === '') {
      return entry.value.length;
    }

    const resolved = this._jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    return JSON.stringify(resolved[0].value).length;
  },

  async jsonResp(key: string, path?: string): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    assertType(entry.type, 'json');

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';

    let val: any;
    if (effectivePath === '$' || effectivePath === '') {
      val = root;
    } else {
      const resolved = this._jsonResolvePath(root, effectivePath);
      if (resolved.length === 0) return null;
      val = resolved[0].value;
    }

    const serializeResp = (v: any): string => {
      if (v === null) return 'null';
      if (typeof v === 'boolean') return v ? '1' : '0';
      if (typeof v === 'number') {
        if (Number.isInteger(v)) return `:${v}`;
        return `$${v}`;
      }
      if (typeof v === 'string') return `$${v.length}\n${v}`;
      if (Array.isArray(v)) {
        return `*${v.length}\n${v.map(serializeResp).join('\n')}`;
      }
      if (typeof v === 'object') {
        const keys = Object.keys(v);
        return `*${keys.length * 2}\n${keys.flatMap((k) => [serializeResp(k), serializeResp(v[k])]).join('\n')}`;
      }
      return String(v);
    };

    return serializeResp(val);
  },

  async jsonMerge(key: string, path: string, value: string): Promise<void> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);

    let parsedValue: any;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      throw new Error('ERR invalid JSON');
    }

    const entry = this.store.get(key);
    if (!entry) {
      this.store.set(key, { value: JSON.stringify(parsedValue), type: 'json', expiresAt: null });
      return;
    }

    let root = JSON.parse(entry.value);

    if (path === '$' || path === '') {
      root = this._deepMerge(root, parsedValue);
    } else {
      const resolved = this._jsonResolvePath(root, path);
      for (const r of resolved) {
        if (r.parent !== null) {
          r.parent[r.key] = this._deepMerge(r.value, parsedValue);
        } else {
          root = this._deepMerge(root, parsedValue);
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
  },

  _deepMerge(target: any, source: any): any {
    if (source === null) return null;
    if (typeof source !== 'object' || Array.isArray(source)) return source;
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return source;
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] === null) {
        delete result[key];
      } else if (
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = this._deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  },
};