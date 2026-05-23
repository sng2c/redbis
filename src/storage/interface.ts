// 스토리지 어댑터 인터페이스 정의
// 향후 다양한 스토리지 백엔드(SQLite, 메모리 등)를
// 플러그인 형태로 교체할 수 있도록 추상화합니다.

import type { GeoSearchResult } from '../utils/geo';
export type { GeoSearchResult } from '../utils/geo';

// === Stream types ===

export interface StreamEntry {
  id: string; // Format: "<milliseconds>-<sequence>"
  fields: Record<string, string>; // field-value pairs
  createdAt: number; // timestamp (ms since epoch) when entry was added
}

export interface StreamConsumer {
  name: string;
  pendingCount: number;
  idleTime: number; // ms since last interaction
  lastDeliveredId: string;
  lastAckTime: number;
}

export interface StreamGroup {
  name: string;
  lastDeliveredId: string;
  entriesRead: number;
  consumers: Map<string, StreamConsumer>;
}

export interface PendingEntry {
  id: string;
  consumer: string;
  group: string;
  deliveredTime: number; // ms since epoch when delivered
  deliveryCount: number;
  lastDeliveredTime: number; // ms since epoch of last delivery
}

export interface StreamInfo {
  length: number;
  firstEntry: StreamEntry | null;
  lastEntry: StreamEntry | null;
  maxDeletedEntryId: string;
  entriesAdded: number;
  recordedFirstEntryId: string;
  groups: number;
}

export interface GroupInfo {
  name: string;
  consumers: number;
  pending: number;
  lastDeliveredId: string;
  entriesRead: number;
  lag: number;
}

// === Sub-interfaces (per-domain) ===

export interface IKeyStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  flush(): Promise<void>;
  mget(keys: string[]): Promise<(string | null)[]>;
  mset(pairs: Array<{ key: string; value: string }>): Promise<void>;
  msetnx(pairs: Array<{ key: string; value: string }>): Promise<boolean>;
  append(key: string, value: string): Promise<number>;
  strlen(key: string): Promise<number>;
  getrange(key: string, start: number, end: number): Promise<string>;
  setrange(key: string, offset: number, value: string): Promise<number>;
  incrby(key: string, delta: number): Promise<number>;
  incrbyfloat(key: string, delta: number): Promise<string>;
  setnx(key: string, value: string): Promise<boolean>;
  setex(key: string, seconds: number, value: string): Promise<void>;
  psetex(key: string, milliseconds: number, value: string): Promise<void>;
  getset(key: string, value: string): Promise<string | null>;
  getdel(key: string): Promise<string | null>;
  getex(
    key: string,
    options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }
  ): Promise<string | null>;
  rename(oldKey: string, newKey: string): Promise<void>;
  renamenx(oldKey: string, newKey: string): Promise<boolean>;
  type(key: string): Promise<string>;
  dbsize(): Promise<number>;
  copy(source: string, destination: string): Promise<boolean>;
  randomkey(): Promise<string | null>;
  unlink(keys: string[]): Promise<number>;
  touch(keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  expireat(key: string, timestamp: number): Promise<boolean>;
  pexpire(key: string, milliseconds: number): Promise<boolean>;
  pexpireat(key: string, millisecondsTimestamp: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  persist(key: string): Promise<boolean>;
  expiretime(key: string): Promise<number>;
  pexpiretime(key: string): Promise<number>;
  scan(
    cursor: number,
    pattern?: string,
    count?: number
  ): Promise<{ cursor: number; keys: string[] }>;
}

export interface IHashStorage {
  hset(key: string, pairs: Array<{ field: string; value: string }>): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, fields: string[]): Promise<number>;
  hgetall(key: string): Promise<Array<{ field: string; value: string }>>;
  hkeys(key: string): Promise<string[]>;
  hvals(key: string): Promise<string[]>;
  hlen(key: string): Promise<number>;
  hexists(key: string, field: string): Promise<boolean>;
  hsetnx(key: string, field: string, value: string): Promise<boolean>;
  hmget(key: string, fields: string[]): Promise<(string | null)[]>;
  hincrby(key: string, field: string, delta: number): Promise<number>;
  hincrbyfloat(key: string, field: string, delta: number): Promise<string>;
  hrandfield(key: string, count: number): Promise<string[]>;
  hscan(
    cursor: number,
    key: string,
    pattern?: string,
    count?: number
  ): Promise<{ cursor: number; items: Array<{ field: string; value: string }> }>;
  hstrlen(key: string, field: string): Promise<number>;
  hgetdel(key: string, fields: string[]): Promise<(string | null)[]>;
  hgetex(
    key: string,
    fields: string[],
    options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }
  ): Promise<(string | null)[]>;
  hsetex(
    key: string,
    pairs: Array<{ field: string; value: string }>,
    options?: { ex?: number; px?: number; exat?: number; pxat?: number; keepttl?: boolean }
  ): Promise<number>;
  hexpire(key: string, fields: string[], seconds: number): Promise<number[]>;
  hexpireat(key: string, fields: string[], timestamp: number): Promise<number[]>;
  hpexpire(key: string, fields: string[], milliseconds: number): Promise<number[]>;
  hpexpireat(key: string, fields: string[], msTimestamp: number): Promise<number[]>;
  hexpiretime(key: string, fields: string[]): Promise<number[]>;
  hpexpiretime(key: string, fields: string[]): Promise<number[]>;
  hpersist(key: string, fields: string[]): Promise<number[]>;
  httl(key: string, fields: string[]): Promise<number[]>;
  hpttl(key: string, fields: string[]): Promise<number[]>;
}

export interface IListStorage {
  lpush(key: string, elements: string[]): Promise<number>;
  rpush(key: string, elements: string[]): Promise<number>;
  lpop(key: string, count?: number): Promise<string | string[] | null>;
  rpop(key: string, count?: number): Promise<string | string[] | null>;
  llen(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lindex(key: string, index: number): Promise<string | null>;
  lset(key: string, index: number, element: string): Promise<void>;
  lrem(key: string, count: number, element: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  lpos(
    key: string,
    element: string,
    options?: { rank?: number; maxlen?: number }
  ): Promise<number | null>;
  rpoplpush(source: string, destination: string): Promise<string | null>;
  lpushx(key: string, element: string): Promise<number>;
  rpushx(key: string, element: string): Promise<number>;
  linsert(
    key: string,
    position: 'BEFORE' | 'AFTER',
    pivot: string,
    element: string
  ): Promise<number>;
  lmove(
    source: string,
    destination: string,
    srcDir: 'LEFT' | 'RIGHT',
    destDir: 'LEFT' | 'RIGHT'
  ): Promise<string | null>;
  blpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null>;
  brpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null>;
  brpoplpush(source: string, destination: string, timeout: number): Promise<string | null>;
  blmove(
    source: string,
    destination: string,
    srcDir: 'LEFT' | 'RIGHT',
    destDir: 'LEFT' | 'RIGHT',
    timeout: number
  ): Promise<string | null>;
  lmpop(
    numkeys: number,
    keys: string[],
    dir: 'LEFT' | 'RIGHT',
    count?: number
  ): Promise<{ key: string; elements: string[] } | null>;
}

export interface ISetStorage {
  sadd(key: string, members: string[]): Promise<number>;
  srem(key: string, members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  scard(key: string): Promise<number>;
  sismember(key: string, member: string): Promise<boolean>;
  smismember(key: string, members: string[]): Promise<boolean[]>;
  srandmember(key: string, count?: number): Promise<string[]>;
  spop(key: string, count?: number): Promise<string[]>;
  smove(source: string, destination: string, member: string): Promise<boolean>;
  sdiff(keys: string[]): Promise<string[]>;
  sinter(keys: string[]): Promise<string[]>;
  sunion(keys: string[]): Promise<string[]>;
  sdiffstore(destination: string, keys: string[]): Promise<number>;
  sinterstore(destination: string, keys: string[]): Promise<number>;
  sunionstore(destination: string, keys: string[]): Promise<number>;
  sintercard(keys: string[], limit?: number): Promise<number>;
  sscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]>;
}

export interface IZSetStorage {
  zadd(
    key: string,
    scoreMembers: Array<{ score: number; member: string }>,
    options?: {
      nx?: boolean;
      xx?: boolean;
      gt?: boolean;
      lt?: boolean;
      ch?: boolean;
      incr?: boolean;
    }
  ): Promise<number | string | null>;
  zrem(key: string, members: string[]): Promise<number>;
  zscore(key: string, member: string): Promise<string | null>;
  zcard(key: string): Promise<number>;
  zrange(
    key: string,
    min: number | string,
    max: number | string,
    options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }
  ): Promise<Array<{ member: string; score: number }>>;
  zrank(key: string, member: string): Promise<number | null>;
  zrevrank(key: string, member: string): Promise<number | null>;
  zincrby(key: string, increment: number, member: string): Promise<string>;
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  zremrangebylex(key: string, min: string, max: string): Promise<number>;
  zlexcount(key: string, min: string, max: string): Promise<number>;
  zscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]>;
  zpopmax(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zpopmin(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zrandmember(key: string, count?: number): Promise<Array<{ member: string; score: number }>>;
  zmscore(key: string, members: string[]): Promise<(string | null)[]>;
  zrangestore(
    destination: string,
    source: string,
    min: number | string,
    max: number | string,
    options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }
  ): Promise<number>;
  zdiff(keys: string[]): Promise<Array<{ member: string; score: number }>>;
  zdiffstore(destination: string, keys: string[]): Promise<number>;
  zunion(
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<Array<{ member: string; score: number }>>;
  zunionstore(
    destination: string,
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<number>;
  zinter(
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<Array<{ member: string; score: number }>>;
  zinterstore(
    destination: string,
    keys: string[],
    options?: { weights?: number[]; aggregate?: string }
  ): Promise<number>;
  zintercard(keys: string[], limit?: number): Promise<number>;
  bzpopmax(
    keys: string[],
    timeout: number
  ): Promise<{ key: string; member: string; score: number } | null>;
  bzpopmin(
    keys: string[],
    timeout: number
  ): Promise<{ key: string; member: string; score: number } | null>;
  bzmpop(
    numkeys: number,
    keys: string[],
    minmax: 'MIN' | 'MAX',
    count?: number
  ): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null>;
  zmpop(
    numkeys: number,
    keys: string[],
    minmax: 'MIN' | 'MAX',
    count?: number
  ): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null>;
}

export interface IBitmapStorage {
  setbit(key: string, offset: number, value: 0 | 1): Promise<number>;
  getbit(key: string, offset: number): Promise<number>;
  bitcount(key: string, start?: number, end?: number): Promise<number>;
  bitpos(key: string, bit: 0 | 1, start?: number, end?: number): Promise<number>;
  bitop(operation: 'AND' | 'OR' | 'XOR' | 'NOT', destkey: string, keys: string[]): Promise<number>;
  bitfield(
    key: string,
    operations: Array<{
      type: 'GET' | 'SET' | 'INCRBY';
      encoding: string;
      offset: number;
      value?: number;
      overflow?: 'WRAP' | 'SAT' | 'FAIL';
    }>
  ): Promise<(number | null)[]>;
  bitfieldRo(
    key: string,
    operations: Array<{ type: 'GET'; encoding: string; offset: number }>
  ): Promise<(number | null)[]>;
}

export interface IHllStorage {
  pfadd(key: string, elements: string[]): Promise<number>;
  pfcount(keys: string[]): Promise<number>;
  pfmerge(destkey: string, sourceKeys: string[]): Promise<void>;
}

export interface IJsonStorage {
  jsonSet(
    key: string,
    path: string,
    value: string,
    nx?: boolean,
    xx?: boolean
  ): Promise<string | null>;
  jsonGet(key: string, paths?: string[]): Promise<string | null>;
  jsonDel(key: string, path?: string): Promise<number>;
  jsonType(key: string, path?: string): Promise<string | null>;
  jsonStrlen(key: string, path?: string): Promise<number | null>;
  jsonStrappend(key: string, path: string, value: string): Promise<number | null>;
  jsonObjkeys(key: string, path?: string): Promise<string[] | null>;
  jsonObjlen(key: string, path?: string): Promise<number | null>;
  jsonArrappend(key: string, path: string, values: string[]): Promise<(number | null)[]>;
  jsonArrpop(key: string, path?: string, index?: number): Promise<string | null>;
  jsonArrlen(key: string, path?: string): Promise<number | null>;
  jsonArrindex(
    key: string,
    path: string,
    value: string,
    start?: number,
    stop?: number
  ): Promise<number | null>;
  jsonArrinsert(
    key: string,
    path: string,
    index: number,
    values: string[]
  ): Promise<(number | null)[]>;
  jsonArrtrim(key: string, path: string, start: number, stop: number): Promise<number | null>;
  jsonNumincrby(key: string, path: string, increment: number): Promise<string | null>;
  jsonNummultby(key: string, path: string, multiplier: number): Promise<string | null>;
  jsonMget(keys: string[], path: string): Promise<(string | null)[]>;
  jsonMset(pairs: Array<{ key: string; path: string; value: string }>): Promise<void>;
  jsonToggle(key: string, path?: string): Promise<string | null>;
  jsonClear(key: string, path?: string): Promise<number>;
  jsonDebugMemory(key: string, path?: string): Promise<number | null>;
  jsonResp(key: string, path?: string): Promise<string | null>;
  jsonMerge(key: string, path: string, value: string): Promise<void>;
}

export interface IGeoStorage {
  geoadd(
    key: string,
    members: Array<{ longitude: number; latitude: number; member: string }>,
    options?: { nx?: boolean; xx?: boolean; ch?: boolean }
  ): Promise<number>;
  geohash(key: string, members: string[]): Promise<(string | null)[]>;
  geopos(key: string, members: string[]): Promise<(Array<number> | null)[]>;
  geodist(
    key: string,
    member1: string,
    member2: string,
    unit?: 'm' | 'km' | 'ft' | 'mi'
  ): Promise<number | null>;
  georadius(
    key: string,
    longitude: number,
    latitude: number,
    radius: number,
    unit: 'm' | 'km' | 'ft' | 'mi',
    options?: {
      withCoord?: boolean;
      withDist?: boolean;
      withHash?: boolean;
      count?: number;
      sort?: 'ASC' | 'DESC';
      store?: string;
      storeDist?: string;
    }
  ): Promise<GeoSearchResult[]>;
  georadiusbymember(
    key: string,
    member: string,
    radius: number,
    unit: 'm' | 'km' | 'ft' | 'mi',
    options?: {
      withCoord?: boolean;
      withDist?: boolean;
      withHash?: boolean;
      count?: number;
      sort?: 'ASC' | 'DESC';
      store?: string;
      storeDist?: string;
    }
  ): Promise<GeoSearchResult[]>;
  geosearch(
    key: string,
    options: {
      fromMember?: string;
      fromLongitude?: number;
      fromLatitude?: number;
      byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' };
      byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' };
      sort?: 'ASC' | 'DESC';
      count?: number;
      any?: boolean;
      withCoord?: boolean;
      withDist?: boolean;
      withHash?: boolean;
    }
  ): Promise<GeoSearchResult[]>;
  geosearchstore(
    destination: string,
    source: string,
    options: {
      fromMember?: string;
      fromLongitude?: number;
      fromLatitude?: number;
      byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' };
      byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' };
      sort?: 'ASC' | 'DESC';
      count?: number;
      any?: boolean;
      storeDist?: boolean;
    }
  ): Promise<number>;
}

export interface IStreamStorage {
  xadd(
    key: string,
    id: string,
    fields: Record<string, string>,
    options?: { maxlen?: number; approx?: boolean; minid?: string; nomkstream?: boolean }
  ): Promise<string | null>;
  xtrim(
    key: string,
    strategy: 'MAXLEN' | 'MINID',
    threshold: string | number,
    approx?: boolean,
    limit?: number
  ): Promise<number>;
  xdel(key: string, ids: string[]): Promise<number>;
  xrange(key: string, start: string, end: string, count?: number): Promise<StreamEntry[]>;
  xrevrange(key: string, end: string, start: string, count?: number): Promise<StreamEntry[]>;
  xlen(key: string): Promise<number>;
  xread(
    keys: string[],
    ids: string[],
    count?: number
  ): Promise<Array<{ key: string; entries: StreamEntry[] }> | null>;
  xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string>;
  xgroupDestroy(key: string, group: string): Promise<number>;
  xgroupCreateconsumer(key: string, group: string, consumer: string): Promise<number>;
  xgroupDelconsumer(key: string, group: string, consumer: string): Promise<number>;
  xgroupSetid(key: string, group: string, id: string): Promise<string>;
  xreadgroup(
    group: string,
    consumer: string,
    keys: string[],
    ids: string[],
    count?: number,
    noack?: boolean
  ): Promise<Array<{ key: string; entries: StreamEntry[] }> | null>;
  xack(key: string, group: string, ids: string[]): Promise<number>;
  xpending(
    key: string,
    group: string,
    options?: { start?: string; end?: string; count?: number; consumer?: string; idle?: number }
  ): Promise<
    | PendingEntry[]
    | {
        count: number;
        minId: string | null;
        maxId: string | null;
        consumers: Array<{ name: string; pending: number }>;
      }
  >;
  xclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    ids: string[],
    options?: {
      idle?: number;
      time?: number;
      retrycount?: number;
      force?: boolean;
      justid?: boolean;
    }
  ): Promise<StreamEntry[] | string[]>;
  xautoclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    start: string,
    options?: { count?: number; justid?: boolean }
  ): Promise<{ nextStartId: string; entries: StreamEntry[] | string[] }>;
  xinfoStream(key: string): Promise<StreamInfo>;
  xinfoGroups(key: string): Promise<GroupInfo[]>;
  xinfoConsumers(key: string, group: string): Promise<StreamConsumer[]>;
  xsetid(key: string, id: string): Promise<string>;
}

export interface ISortStorage {
  sort(
    key: string,
    options?: {
      byPattern?: string;
      limit?: { offset: number; count: number };
      getPatterns?: string[];
      sortOrder?: 'ASC' | 'DESC';
      alpha?: boolean;
      store?: string;
    }
  ): Promise<string[] | number>;
}

export interface ICustomStorage {
  delex(key: string, conditions: Array<{ operator: string; value: string }>): Promise<number>;
  msetex(pairs: Array<{ key: string; seconds: number; value: string }>): Promise<number>;
}

export interface IServerStorage {
  save(): Promise<void>;
  bgsave(): Promise<string>;
  info(section?: string): Promise<string>;
  getLastSaveTime(): Promise<number>;
}

// === Composed interface ===

export interface IStorage
  extends
    IKeyStorage,
    IHashStorage,
    IListStorage,
    ISetStorage,
    IZSetStorage,
    IBitmapStorage,
    IHllStorage,
    IJsonStorage,
    IGeoStorage,
    IStreamStorage,
    ISortStorage,
    ICustomStorage,
    IServerStorage {}

export interface StorageConfig {
  path: string;
}
