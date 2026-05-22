// SqliteStorage — composed from core + mixin modules.
// Data-type methods are applied via Object.assign to the prototype.
// TS declaration merging ensures SqliteStorage is typed as IStorage.

import { SqliteStorage } from './core';
import type { IStorage } from '../interface';
import { hashMethods } from './hash';
import { listMethods } from './list';
import { setMethods } from './set';
import { zsetMethods } from './zset';
import { bitmapMethods } from './bitmap';
import { hllMethods } from './hll';
import { jsonMethods } from './json';
import { streamMethods } from './stream';
import { geoMethods } from './geo';
import { sortMethods } from './sort';
import { customMethods } from './custom';
import { serverMethods } from './server';

// Apply all mixin methods to the prototype
Object.assign(SqliteStorage.prototype,
  hashMethods,
  listMethods,
  setMethods,
  zsetMethods,
  bitmapMethods,
  hllMethods,
  jsonMethods,
  streamMethods,
  geoMethods,
  sortMethods,
  customMethods,
  serverMethods,
);

// TypeScript declaration merging: SqliteStorage implements IStorage
declare module './core' {
  interface SqliteStorage extends IStorage {}
}

export { SqliteStorage } from './core';
export { formatMemoryHuman, globToRegex } from './types';
export type { InternalStreamGroup, StreamData } from './types';
