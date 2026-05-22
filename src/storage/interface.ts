// 스토리지 어댑터 인터페이스 정의
// 향후 다양한 스토리지 백엔드(SQLite, 메모리 등)를
// 플러그인 형태로 교체할 수 있도록 추상화합니다.

export interface IStorage {
  // === Existing (DO NOT CHANGE) ===
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  flush(): Promise<void>;

  // === NEW: Multi-key ===
  mget(keys: string[]): Promise<(string | null)[]>;
  mset(pairs: Array<{ key: string; value: string }>): Promise<void>;
  msetnx(pairs: Array<{ key: string; value: string }>): Promise<boolean>;

  // === NEW: String operations ===
  append(key: string, value: string): Promise<number>;          // returns new length
  strlen(key: string): Promise<number>;
  getrange(key: string, start: number, end: number): Promise<string>;
  setrange(key: string, offset: number, value: string): Promise<number>; // returns new length
  incrby(key: string, delta: number): Promise<number>;           // INCR/DECR/INCRBY/DECRBY all use this
  incrbyfloat(key: string, delta: number): Promise<string>;     // returns string repr

  // === NEW: Conditional set ===
  setnx(key: string, value: string): Promise<boolean>;          // true if set
  setex(key: string, seconds: number, value: string): Promise<void>;
  psetex(key: string, milliseconds: number, value: string): Promise<void>;
  getset(key: string, value: string): Promise<string | null>;   // returns old value
  getdel(key: string): Promise<string | null>;                   // returns value then deletes
  getex(key: string, options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<string | null>;

  // === NEW: Key management ===
  rename(oldKey: string, newKey: string): Promise<void>;         // throws if oldKey doesn't exist
  renamenx(oldKey: string, newKey: string): Promise<boolean>;    // true if renamed
  type(key: string): Promise<string>;                            // 'string'|'hash'|'list'|'set'|'zset'|'none'
  dbsize(): Promise<number>;
  copy(source: string, destination: string): Promise<boolean>;  // true if copied
  randomkey(): Promise<string | null>;
  unlink(keys: string[]): Promise<number>;                      // returns count of deleted keys
  touch(keys: string[]): Promise<number>;                       // returns count of existing keys

  // === NEW: Expiry ===
  expire(key: string, seconds: number): Promise<boolean>;        // true if timeout set
  expireat(key: string, timestamp: number): Promise<boolean>;
  pexpire(key: string, milliseconds: number): Promise<boolean>;
  pexpireat(key: string, millisecondsTimestamp: number): Promise<boolean>;
  ttl(key: string): Promise<number>;                              // -1=no expiry, -2=key missing
  pttl(key: string): Promise<number>;
  persist(key: string): Promise<boolean>;                        // true if timeout removed
  expiretime(key: string): Promise<number>;                      // unix sec, -1=no expiry, -2=missing
  pexpiretime(key: string): Promise<number>;                    // unix ms

  // === NEW: SCAN ===
  scan(cursor: number, pattern?: string, count?: number): Promise<{ cursor: number; keys: string[] }>;

  // === Hash operations ===
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
  hscan(cursor: number, key: string, pattern?: string, count?: number): Promise<{ cursor: number; items: Array<{ field: string; value: string }> }>;
  hstrlen(key: string, field: string): Promise<number>;
  hgetdel(key: string, fields: string[]): Promise<(string | null)[]>;
  hgetex(key: string, fields: string[], options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<(string | null)[]>;
  hsetex(key: string, pairs: Array<{ field: string; value: string }>, options?: { ex?: number; px?: number; exat?: number; pxat?: number; keepttl?: boolean }): Promise<number>;

  // Hash field expiry
  hexpire(key: string, fields: string[], seconds: number): Promise<number[]>;
  hexpireat(key: string, fields: string[], timestamp: number): Promise<number[]>;
  hpexpire(key: string, fields: string[], milliseconds: number): Promise<number[]>;
  hpexpireat(key: string, fields: string[], msTimestamp: number): Promise<number[]>;
  hexpiretime(key: string, fields: string[]): Promise<number[]>;
  hpexpiretime(key: string, fields: string[]): Promise<number[]>;
  hpersist(key: string, fields: string[]): Promise<number[]>;
  httl(key: string, fields: string[]): Promise<number[]>;
  hpttl(key: string, fields: string[]): Promise<number[]>;

  // === List operations ===
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
  lpos(key: string, element: string, options?: { rank?: number; maxlen?: number }): Promise<number | null>;
  rpoplpush(source: string, destination: string): Promise<string | null>;
  lpushx(key: string, element: string): Promise<number>;
  rpushx(key: string, element: string): Promise<number>;
  linsert(key: string, position: 'BEFORE' | 'AFTER', pivot: string, element: string): Promise<number>;
  lmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT'): Promise<string | null>;
  blpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null>;
  brpop(keys: string[], timeout: number): Promise<{ key: string; element: string } | null>;
  brpoplpush(source: string, destination: string, timeout: number): Promise<string | null>;
  blmove(source: string, destination: string, srcDir: 'LEFT' | 'RIGHT', destDir: 'LEFT' | 'RIGHT', timeout: number): Promise<string | null>;
  lmpop(numkeys: number, keys: string[], dir: 'LEFT' | 'RIGHT', count?: number): Promise<{ key: string; elements: string[] } | null>;

  // ── Set operations ──
  sadd(key: string, members: string[]): Promise<number>;           // returns count of NEW members added
  srem(key: string, members: string[]): Promise<number>;           // returns count of members removed
  smembers(key: string): Promise<string[]>;                        // returns all members
  scard(key: string): Promise<number>;                             // returns member count
  sismember(key: string, member: string): Promise<boolean>;        // true/false
  smismember(key: string, members: string[]): Promise<boolean[]>;   // array of booleans
  srandmember(key: string, count?: number): Promise<string[]>;     // random members (negative count → duplicates)
  spop(key: string, count?: number): Promise<string[]>;           // remove + return random members
  smove(source: string, destination: string, member: string): Promise<boolean>; // true if moved
  sdiff(keys: string[]): Promise<string[]>;                        // diff of first key against rest
  sinter(keys: string[]): Promise<string[]>;                       // intersection
  sunion(keys: string[]): Promise<string[]>;                       // union
  sdiffstore(destination: string, keys: string[]): Promise<number>; // diff → store, return count
  sinterstore(destination: string, keys: string[]): Promise<number>; // inter → store, return count
  sunionstore(destination: string, keys: string[]): Promise<number>; // union → store, return count
  sintercard(keys: string[], limit?: number): Promise<number>;     // intersection cardinality, optional LIMIT
  sscan(key: string, cursor: number, pattern?: string, count?: number): Promise<[number, string[]]>; // cursor iteration

  // === Sorted Set operations ===
  zadd(key: string, scoreMembers: Array<{ score: number; member: string }>, options?: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean; ch?: boolean; incr?: boolean }): Promise<number | string | null>;
  zrem(key: string, members: string[]): Promise<number>;
  zscore(key: string, member: string): Promise<string | null>;
  zcard(key: string): Promise<number>;
  zrange(key: string, min: number | string, max: number | string, options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }): Promise<Array<{ member: string; score: number }>>;
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
  zrangestore(destination: string, source: string, min: number | string, max: number | string, options?: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number }): Promise<number>;
  zdiff(keys: string[]): Promise<Array<{ member: string; score: number }>>;
  zdiffstore(destination: string, keys: string[]): Promise<number>;
  zunion(keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<Array<{ member: string; score: number }>>;
  zunionstore(destination: string, keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<number>;
  zinter(keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<Array<{ member: string; score: number }>>;
  zinterstore(destination: string, keys: string[], options?: { weights?: number[]; aggregate?: string }): Promise<number>;
  zintercard(keys: string[], limit?: number): Promise<number>;
  bzpopmax(keys: string[], timeout: number): Promise<{ key: string; member: string; score: number } | null>;
  bzpopmin(keys: string[], timeout: number): Promise<{ key: string; member: string; score: number } | null>;
  bzmpop(numkeys: number, keys: string[], minmax: 'MIN' | 'MAX', count?: number): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null>;
  zmpop(numkeys: number, keys: string[], minmax: 'MIN' | 'MAX', count?: number): Promise<{ key: string; elements: Array<{ member: string; score: number }> } | null>;

  // === Server / Persistence ===

  /** Force a save/flush of data to persistent storage. No-op for InMemoryStorage. */
  save(): Promise<void>;

  /** Return server info as a plain-text string (key:value lines). Section is optional (return all info if omitted). */
  info(section?: string): Promise<string>;

  /** Return the last save time as a Unix timestamp (seconds). 0 if never saved. */
  getLastSaveTime(): Promise<number>;
}

export interface StorageConfig {
  path: string;
}