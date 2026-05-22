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
}

export interface StorageConfig {
  path: string;
}