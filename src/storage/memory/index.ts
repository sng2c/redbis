// InMemoryStorage — composed from core + mixin modules.
// Data-type methods are applied via Object.assign to the prototype.
// TS declaration merging ensures InMemoryStorage is typed as IStorage.

import { InMemoryStorage } from './core';
import type { IStorage } from '../interface';
import { hashMethods } from './hash';
import { setMethods } from './set';
import { listMethods } from './list';
import { zsetMethods } from './zset';
import { bitmapMethods } from './bitmap';
import { hllMethods } from './hll';
import { jsonMethods } from './json';
import { geoMethods } from './geo';
import { streamMethods } from './stream';
import { sortMethods } from './sort';
import { customMethods } from './custom';
import { serverMethods } from './server';

// Apply all mixin methods to the prototype
Object.assign(InMemoryStorage.prototype,
  hashMethods,
  listMethods,
  setMethods,
  zsetMethods,
  bitmapMethods,
  hllMethods,
  jsonMethods,
  geoMethods,
  streamMethods,
  sortMethods,
  customMethods,
  serverMethods,
);

// TypeScript declaration merging: InMemoryStorage implements IStorage
declare module './core' {
  interface InMemoryStorage extends IStorage {}
}

export { InMemoryStorage } from './core';
export { formatMemoryHuman } from './types';
export type { StoreEntry, StreamData, InternalStreamConsumer, InternalStreamGroup } from './types';
