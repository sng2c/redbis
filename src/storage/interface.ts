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
}

export interface StorageConfig {
  path: string;
}