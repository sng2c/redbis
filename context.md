# Codebase Recon — Phase 1 State

## 1. IStorage Interface (`src/storage/interface.ts`)

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
  type(key: string): Promise<string>;            // 'string'|'hash'|'list'|'set'|'zset'|'none'
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
  ttl(key: string): Promise<number>;              // -1=no expiry, -2=key missing
  pttl(key: string): Promise<number>;
  persist(key: string): Promise<boolean>;
  expiretime(key: string): Promise<number>;       // unix sec
  pexpiretime(key: string): Promise<number>;      // unix ms
  // SCAN
  scan(cursor: number, pattern?: string, count?: number): Promise<{ cursor: number; keys: string[] }>;
}

export interface StorageConfig { path: string; }
```

## 2. InMemoryStorage (`src/storage/memory.ts`)

**Data structure:**
```typescript
type StoreEntry = { value: string; type: string; expiresAt: number | null };
private store: Map<string, StoreEntry> = new Map();
```
- `type` field currently always 'string' (placeholder for future data types)
- `expiresAt` is epoch-ms or null (no expiry)

**Eviction (lazy, on-access):**
- `isExpired(entry)`: `entry.expiresAt !== null && Date.now() >= entry.expiresAt`
- `evictIfExpired(key)`: checks single key, deletes if expired
- `evictAllExpired()`: iterates all entries, deletes expired ones
- Called at start of every read/write method; `evictAllExpired()` used in `keys()`, `dbsize()`, `randomkey()`, `scan()`

**Pattern matching:** `globToRegex(pattern)`: `*` → `.*`, `?` → `.`, escapes `.+^${}()|[]\\`

## 3. SqliteStorage (`src/storage/sqlite.ts`)

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```
**Migrations** (run in constructor after CREATE TABLE):
- `ALTER TABLE kv_store ADD COLUMN type TEXT DEFAULT 'string'`
- `ALTER TABLE kv_store ADD COLUMN expires_at INTEGER DEFAULT NULL`

**Constructor:** `new Database(config.path)` then CREATE TABLE + migrate(). Creates parent dirs for non-`:memory:` paths.

**Eviction:**
- `evictExpired(key)`: `DELETE FROM kv_store WHERE key = ? AND expires_at IS NOT NULL AND expires_at <= ?` (param: Date.now())
- `evictAllExpired()`: `DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?`
- Same lazy-on-access pattern as InMemory

**Pattern matching:** Top-level `globToRegex()` — identical logic to InMemory's private version. No SQL `LIKE` or GLOB usage.

**SCAN:** Uses `rowid`-based cursoring: `SELECT key, rowid FROM kv_store WHERE rowid > ? ORDER BY rowid`

## 4. CommandHandler (`src/command/handler.ts`)

**Constructor:** `constructor(storage: IStorage)`

**Switch cases** (command → private method):
| Command | Method |
|---------|--------|
| PING | `ping(args)` |
| SET | `handleSet(args)` |
| GET | `handleGet(args)` |
| DEL | `handleDel(args)` |
| KEYS | `handleKeys(args)` |
| EXISTS | `handleExists(args)` |
| FLUSHDB/FLUSHALL | `handleFlushdb()` |
| COMMAND | `handleCommand()` |
| MGET | `handleMget(args)` |
| MSET | `handleMset(args)` |
| MSETNX | `handleMsetnx(args)` |
| APPEND | `handleAppend(args)` |
| STRLEN | `handleStrlen(args)` |
| GETRANGE | `handleGetrange(args)` |
| SETRANGE | `handleSetrange(args)` |
| INCR | `handleIncr(args)` → calls `incrby(key, 1)` |
| DECR | `handleDecr(args)` → calls `incrby(key, -1)` |
| INCRBY | `handleIncrby(args)` |
| DECRBY | `handleDecrby(args)` → calls `incrby(key, -delta)` |
| INCRBYFLOAT | `handleIncrbyfloat(args)` |
| SETNX | `handleSetnx(args)` |
| SETEX | `handleSetex(args)` |
| PSETEX | `handlePsetex(args)` |
| GETSET | `handleGetset(args)` |
| GETDEL | `handleGetdel(args)` |
| GETEX | `handleGetex(args)` |
| RENAME | `handleRename(args)` |
| RENAMENX | `handleRenamenx(args)` |
| TYPE | `handleType(args)` |
| DBSIZE | `handleDbsize()` |
| COPY | `handleCopy(args)` |
| RANDOMKEY | `handleRandomkey()` |
| UNLINK | `handleUnlink(args)` |
| TOUCH | `handleTouch(args)` |
| SCAN | `handleScan(args)` |
| EXPIRE | `handleExpire(args)` |
| EXPIREAT | `handleExpireat(args)` |
| PEXPIRE | `handlePexpire(args)` |
| PEXPIREAT | `handlePexpireat(args)` |
| TTL | `handleTtl(args)` |
| PTTL | `handlePttl(args)` |
| PERSIST | `handlePersist(args)` |
| EXPIRETIME | `handleExpiretime(args)` |
| PEXPIRETIME | `handlePexpiretime(args)` |
| ECHO | `handleEcho(args)` |
| QUIT | `handleQuit()` |
| LCS | `handleLcs(args)` — DP-based, supports LEN/IDX/WITHMATCHLEN/MINMATCHLEN |

**SET flags:** EX, PX, EXAT, PXAT, NX, XX, GET, KEEPTTL

**GETEX flags:** EX, PX, EXAT, PXAT, PERSIST

**SCAN flags:** MATCH, COUNT

**Private method signatures (all return `Promise<string>` or `string`):**
- `ping(args: string[]): string`
- `handleEcho(args: string[]): string`
- `handleQuit(): string`
- All `handle*` async methods take `args: string[]` or no args, return `Promise<string>`
- `handleLcs(args: string[]): Promise<string>` — internal DP LCS implementation

## 5. Test Structure

| File | Test Count |
|------|-----------|
| command.test.ts | 39 |
| config.test.ts | 32 |
| connection.test.ts | 15 |
| implementation.test.ts | 32 |
| logger.test.ts | 10 |
| memory-storage.test.ts | 21 |
| parser.test.ts | 23 |
| resp.test.ts | 24 |
| server.test.ts | 13 |
| sqlite.test.ts | 23 |
| **Total** | **232** |

## 6. Expiry / Lazy Eviction Mechanism

Both storage implementations use **lazy eviction** — no background timer or sweep thread.

**InMemoryStorage:**
- Each entry: `StoreEntry { value, type, expiresAt: number|null }`
- `expiresAt` = epoch-ms absolute time, or `null` (no TTL)
- `evictIfExpired(key)`: called at start of every method that touches a specific key; deletes entry if `Date.now() >= expiresAt`
- `evictAllExpired()`: full scan of `this.store`, deletes all expired; called by `keys()`, `dbsize()`, `randomkey()`, `scan()`
- `ttl()`/`pttl()`: compute remaining ms from `expiresAt`; return `-1` if no expiry, `-2` if key missing; delete key if race-condition expired

**SqliteStorage:**
- Column `expires_at INTEGER DEFAULT NULL` — epoch-ms or NULL
- `evictExpired(key)`: `DELETE WHERE key=? AND expires_at IS NOT NULL AND expires_at <= Date.now()`
- `evictAllExpired()`: `DELETE WHERE expires_at IS NOT NULL AND expires_at <= Date.now()`
- Same lazy pattern: evict before every read/write; `evictAllExpired()` before `keys()`, `dbsize()`, `randomkey()`, `scan()`
- SET/SETEX/PSETEX use `INSERT OR REPLACE` with computed `expires_at`
- Expiry mutations (EXPIRE/PEXPIRE/etc.) use `UPDATE kv_store SET expires_at = ? WHERE key = ?`