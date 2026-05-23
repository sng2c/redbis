// @ts-nocheck
import { assertType } from '../type-check';
import type { InMemoryStorage } from './core';

export const jsonMethods = {
  _ensureJsonTypeOrThrow(key: string): void {
    assertType(this.store.get(key)?.type, 'json');
  },

  _parseJsonPath(
    path: string
  ): Array<{ type: 'field'; name: string } | { type: 'index'; index: number }> {
    let p = path;
    if (p === '$' || p === '.') return [];
    if (p.startsWith('$.')) p = p.slice(2);
    else if (p.startsWith('$')) p = p.slice(1);
    else if (p.startsWith('.')) p = p.slice(1);

    const segments: Array<{ type: 'field'; name: string } | { type: 'index'; index: number }> = [];
    let i = 0;
    while (i < p.length) {
      if (p[i] === '[') {
        const end = p.indexOf(']', i);
        if (end === -1) break;
        const content = p.slice(i + 1, end);
        if (/^\d+$/.test(content)) {
          segments.push({ type: 'index', index: parseInt(content) });
        } else {
          const fieldName = content.replace(/^['"]|['"]$/g, '');
          segments.push({ type: 'field', name: fieldName });
        }
        i = end + 1;
        if (i < p.length && p[i] === '.') i++;
      } else {
        let end = i;
        while (end < p.length && p[end] !== '.' && p[end] !== '[') end++;
        const fieldName = p.slice(i, end);
        if (fieldName) segments.push({ type: 'field', name: fieldName });
        i = end;
        if (i < p.length && p[i] === '.') i++;
      }
    }
    return segments;
  },

  _jsonResolvePath(root: any, path: string): { parent: any; key: string | number; value: any }[] {
    if (path === '$' || path === '.' || path === '') {
      return [{ parent: null, key: '', value: root }];
    }

    const segments = this._parseJsonPath(path);
    let current: { parent: any; key: string | number; value: any }[] = [
      { parent: null, key: '', value: root },
    ];

    for (const seg of segments) {
      const next: { parent: any; key: string | number; value: any }[] = [];
      for (const item of current) {
        if (seg.type === 'field') {
          if (
            item.value !== null &&
            typeof item.value === 'object' &&
            !Array.isArray(item.value) &&
            seg.name in item.value
          ) {
            next.push({ parent: item.value, key: seg.name, value: item.value[seg.name] });
          }
        } else if (seg.type === 'index') {
          if (Array.isArray(item.value) && seg.index < item.value.length && seg.index >= 0) {
            next.push({ parent: item.value, key: seg.index, value: item.value[seg.index] });
          }
        }
      }
      current = next;
    }
    return current;
  },

  _jsonTypeOf(val: any): string {
    if (val === null) return 'null';
    if (Array.isArray(val)) return 'array';
    if (typeof val === 'object') return 'object';
    if (typeof val === 'boolean') return 'boolean';
    if (typeof val === 'number') {
      return Number.isInteger(val) ? 'integer' : 'number';
    }
    if (typeof val === 'string') return 'string';
    return 'unknown';
  },

  async jsonSet(
    key: string,
    path: string,
    value: string,
    nx?: boolean,
    xx?: boolean
  ): Promise<string | null> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);

    let parsedValue: any;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      throw new Error('ERR invalid JSON');
    }

    if (path === '$' || path === '') {
      if (nx && this.store.has(key)) return null;
      if (xx && !this.store.has(key)) return null;
      this.store.set(key, {
        value: JSON.stringify(parsedValue),
        type: 'json',
        expiresAt: this.store.get(key)?.expiresAt ?? null,
      });
      return 'OK';
    }

    // Non-root path
    const entry = this.store.get(key);
    if (!entry) {
      if (xx) return null;
      // Can't set a sub-path on non-existent key — need root object
      this.store.set(key, { value: JSON.stringify(parsedValue), type: 'json', expiresAt: null });
      return 'OK';
    }

    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, path);
    if (resolved.length === 0) {
      if (xx) return null;
      return null;
    }
    if (nx && resolved.length > 0) return null;

    for (const r of resolved) {
      if (r.parent !== null) {
        if (typeof r.key === 'number') {
          r.parent[r.key] = parsedValue;
        } else {
          r.parent[r.key] = parsedValue;
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return 'OK';
  },

  async jsonGet(key: string, paths?: string[]): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    assertType(entry.type, 'json');

    const root = JSON.parse(entry.value);

    if (!paths || paths.length === 0) {
      return entry.value;
    }

    if (paths.length === 1) {
      const resolved = this._jsonResolvePath(root, paths[0]);
      if (resolved.length === 0) return null;
      return JSON.stringify(resolved[0].value);
    }

    // Multiple paths: return as object mapping paths to values
    const result: Record<string, any> = {};
    for (const p of paths) {
      const resolved = this._jsonResolvePath(root, p);
      if (resolved.length === 0) {
        result[p] = null;
      } else {
        result[p] = resolved[0].value;
      }
    }
    return JSON.stringify(result);
  },

  async jsonDel(key: string, path?: string): Promise<number> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return 0;
    assertType(entry.type, 'json');

    if (!path || path === '$') {
      this.store.delete(key);
      return 1;
    }

    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, path);
    if (resolved.length === 0) return 0;

    let count = 0;
    // Delete in reverse order to handle nested paths
    for (let i = resolved.length - 1; i >= 0; i--) {
      const r = resolved[i];
      if (r.parent !== null) {
        if (Array.isArray(r.parent)) {
          r.parent.splice(r.key as number, 1);
        } else {
          delete r.parent[r.key as string];
        }
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

  async jsonType(key: string, path?: string): Promise<string | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    assertType(entry.type, 'json');

    const root = JSON.parse(entry.value);
    if (!path || path === '$') {
      return this._jsonTypeOf(root);
    }

    const resolved = this._jsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    return this._jsonTypeOf(resolved[0].value);
  },

  async jsonStrlen(key: string, path?: string): Promise<number | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    assertType(entry.type, 'json');

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';
    const resolved = this._jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;
    if (resolved.length === 1) {
      if (typeof resolved[0].value === 'string') return resolved[0].value.length;
      return null;
    }
    // Multiple matches shouldn't happen with simple paths
    return null;
  },

  async jsonStrappend(key: string, path: string, value: string): Promise<number | null> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) throw new Error('ERR key not found');

    let root = JSON.parse(entry.value);
    let appendString: string;
    try {
      appendString = JSON.parse(value);
    } catch {
      throw new Error('ERR invalid JSON');
    }
    if (typeof appendString !== 'string') throw new Error('ERR value is not a string');

    const resolved = this._jsonResolvePath(root, path);
    if (resolved.length === 0) return null;

    for (const r of resolved) {
      if (typeof r.value === 'string') {
        if (r.parent !== null) {
          r.parent[r.key] = r.value + appendString;
        } else {
          root = root + appendString;
        }
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    const newResolved = this._jsonResolvePath(root, path);
    if (newResolved.length > 0 && typeof newResolved[0].value === 'string') {
      return newResolved[0].value.length;
    }
    return null;
  },

  async jsonObjkeys(key: string, path?: string): Promise<string[] | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    assertType(entry.type, 'json');

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';
    const resolved = this._jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    const val = resolved[0].value;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val);
    }
    return null;
  },

  async jsonObjlen(key: string, path?: string): Promise<number | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    assertType(entry.type, 'json');

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';
    const resolved = this._jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    const val = resolved[0].value;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val).length;
    }
    return null;
  },

  async jsonArrappend(key: string, path: string, values: string[]): Promise<(number | null)[]> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) throw new Error('ERR key not found');

    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, path);
    const results: (number | null)[] = [];

    const parsedValues: any[] = values.map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    });

    for (const r of resolved) {
      if (Array.isArray(r.value)) {
        r.value.push(...parsedValues);
        if (r.parent !== null) {
          r.parent[r.key] = r.value;
        }
        results.push(r.value.length);
      } else {
        results.push(null);
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return results;
  },

  async jsonArrpop(key: string, path?: string, index?: number): Promise<string | null> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    const effectivePath = path || '$';
    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    const r = resolved[0];
    if (!Array.isArray(r.value)) return null;

    const arr = r.value;
    let idx = index ?? -1;
    if (idx < 0) idx = arr.length + idx;
    if (idx < 0 || idx >= arr.length) return null;

    const popped = arr.splice(idx, 1)[0];
    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return JSON.stringify(popped);
  },

  async jsonArrlen(key: string, path?: string): Promise<number | null> {
    this.evictIfExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    assertType(entry.type, 'json');

    const root = JSON.parse(entry.value);
    const effectivePath = path || '$';
    const resolved = this._jsonResolvePath(root, effectivePath);
    if (resolved.length === 0) return null;

    const val = resolved[0].value;
    if (Array.isArray(val)) return val.length;
    return null;
  },

  async jsonArrindex(
    key: string,
    path: string,
    value: string,
    start?: number,
    stop?: number
  ): Promise<number | null> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, path);
    if (resolved.length === 0) return null;
    if (!Array.isArray(resolved[0].value)) return null;

    let searchValue: any;
    try {
      searchValue = JSON.parse(value);
    } catch {
      searchValue = value;
    }

    const arr = resolved[0].value;
    const s = start ?? 0;
    const effectiveStop = stop ?? 0;

    for (let i = s; i < arr.length; i++) {
      if (effectiveStop > 0 && i > effectiveStop) break;
      if (JSON.stringify(arr[i]) === JSON.stringify(searchValue)) {
        return i;
      }
    }
    return -1;
  },

  async jsonArrinsert(
    key: string,
    path: string,
    index: number,
    values: string[]
  ): Promise<(number | null)[]> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) throw new Error('ERR key not found');

    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, path);
    const results: (number | null)[] = [];

    const parsedValues: any[] = values.map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    });

    for (const r of resolved) {
      if (Array.isArray(r.value)) {
        r.value.splice(index, 0, ...parsedValues);
        results.push(r.value.length);
      } else {
        results.push(null);
      }
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return results;
  },

  async jsonArrtrim(
    key: string,
    path: string,
    start: number,
    stop: number
  ): Promise<number | null> {
    this.evictIfExpired(key);
    this._ensureJsonTypeOrThrow(key);
    const entry = this.store.get(key);
    if (!entry) return null;

    let root = JSON.parse(entry.value);
    const resolved = this._jsonResolvePath(root, path);
    if (resolved.length === 0) return null;

    const r = resolved[0];
    if (!Array.isArray(r.value)) return null;

    let s = start;
    let e = stop;
    if (s < 0) s = r.value.length + s;
    if (e < 0) e = r.value.length + e;
    if (s < 0) s = 0;
    if (e >= r.value.length) e = r.value.length - 1;
    if (s > e) {
      r.value.length = 0;
    } else {
      r.value.splice(0, s);
      r.value.splice(e - s + 1);
    }

    this.store.set(key, { value: JSON.stringify(root), type: 'json', expiresAt: entry.expiresAt });
    return r.value.length;
  },

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
