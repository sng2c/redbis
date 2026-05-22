# Codebase Recon: List Phase

## IStorage Interface (`src/storage/interface.ts`)

```typescript
export interface IStorage {
  // Existing
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  flush(): Promise<void>;

  // Multi-key
  mget(keys: string[]): Promise<(string | null)[]>;
  mset(pairs: Array<{ key: string; value: string }>): Promise<void>;
  msetnx(pairs: Array<{ key: string; value: string }>): Promise<boolean>;

  // String operations
  append(key: string, value: string): Promise<number>;
  strlen(key: string): Promise<number>;
  getrange(key: string, start: number, end: number): Promise<string>;
  setrange(key: string, offset: number, value: string): Promise<number>;
  incrby(key: string, delta: number): Promise<number>;
  incrbyfloat(key: string, delta: number): Promise<string>;

  // Conditional set
  setnx(key: string, value: string): Promise<boolean>;
  setex(key: string, seconds: number, value: string): Promise<void>;
  psetex(key: string, milliseconds: number, value: string): Promise<void>;
  getset(key: string, value: string): Promise<string | null>;
  getdel(key: string): Promise<string | null>;
  getex(key: string, options?: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean }): Promise<string | null>;

  // Key management
  rename(oldKey: string, newKey: string): Promise<void>;
  renamenx(oldKey: string, newKey: string): Promise<boolean>;
  type(key: string): Promise<string>;
  dbsize(): Promise<number>;
  copy(source: string, destination: string): Promise<boolean>;
  randomkey(): Promise<string | null>;
  unlink(keys: string[]): Promise<number>;
  touch(keys: string[]): Promise<number>;

  // Expiry
  expire(key: string, seconds: number): Promise<boolean>;
  expireat(key: string, timestamp: number): Promise<boolean>;
  pexpire(key: string, milliseconds: number): Promise<boolean>;
  pexpireat(key: string, millisecondsTimestamp: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  persist(key: string): Promise<boolean>;
  expiretime(key: string): Promise<number>;
  pexpiretime(key: string): Promise<number>;

  // SCAN
  scan(cursor: number, pattern?: string, count?: number): Promise<{ cursor: number; keys: string[] }>;

  // Hash operations
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
```

## InMemoryStorage Internal Structures (`src/storage/memory.ts`)

```typescript
type StoreEntry = { value: string; type: string; expiresAt: number | null };
// hashStore value type: { value: string; expiresAt: number | null }

export class InMemoryStorage implements IStorage {
  private store: Map<string, StoreEntry> = new Map();
  private hashStore: Map<string, Map<string, { value: string; expiresAt: number | null }>> = new Map();
}
```

## SqliteStorage Schema (`src/storage/sqlite.ts`)

```sql
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Migrations add columns: type TEXT DEFAULT 'string', expires_at INTEGER DEFAULT NULL

CREATE TABLE IF NOT EXISTS hash_store (
  key TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER DEFAULT NULL,
  PRIMARY KEY (key, field)
);
```

## CommandHandler Switch Cases (`src/command/handler.ts`)

```typescript
switch (command) {
  // Core
  case 'PING':    case 'SET':    case 'GET':    case 'DEL':
  case 'KEYS':    case 'EXISTS': case 'FLUSHDB': case 'FLUSHALL':
  case 'COMMAND':
  // Multi-key
  case 'MGET':    case 'MSET':   case 'MSETNX':
  // String ops
  case 'APPEND':  case 'STRLEN': case 'GETRANGE': case 'SETRANGE':
  case 'INCR':    case 'DECR':   case 'INCRBY':   case 'DECRBY':
  case 'INCRBYFLOAT':
  // Conditional set
  case 'SETNX':   case 'SETEX':  case 'PSETEX':   case 'GETSET':
  case 'GETDEL':  case 'GETEX':
  // Key management
  case 'RENAME':  case 'RENAMENX': case 'TYPE':  case 'DBSIZE':
  case 'COPY':    case 'RANDOMKEY': case 'UNLINK': case 'TOUCH':
  case 'SCAN':
  // Expiry
  case 'EXPIRE':  case 'EXPIREAT': case 'PEXPIRE': case 'PEXPIREAT':
  case 'TTL':     case 'PTTL':    case 'PERSIST':  case 'EXPIRETIME':
  case 'PEXPIRETIME':
  // Misc
  case 'ECHO':    case 'QUIT':    case 'LCS':
  // Hash ops
  case 'HSET':    case 'HGET':    case 'HDEL':     case 'HGETALL':
  case 'HKEYS':   case 'HVALS':   case 'HLEN':     case 'HEXISTS':
  case 'HSETNX':  case 'HMSET':   case 'HMGET':    case 'HINCRBY':
  case 'HINCRBYFLOAT': case 'HRANDFIELD': case 'HSCAN':
  case 'HSTRLEN': case 'HGETDEL': case 'HGETEX':   case 'HSETEX':
  // Hash field expiry
  case 'HEXPIRE': case 'HEXPIREAT': case 'HPEXPIRE': case 'HPEXPIREAT':
  case 'HEXPIRETIME': case 'HPEXPIRETIME': case 'HPERSIST':
  case 'HTTL':   case 'HPTTL':
}
```