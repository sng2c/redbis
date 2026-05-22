----
# Task #0 (for Planner)

### Goal
Refactor `src/command/handler.ts` (5,508 lines) from a single monolithic file into feature-based modules using a Command Registry pattern, reducing maximum file size from 5,508 lines to ~500 lines and eliminating the 267-line `executeDirect` duplication.

### Background
Redbis is a Redis-protocol (RESP) compatible server with Memory and SQLite storage backends. The command handler (`src/command/handler.ts`) contains 150+ handler methods in a single 5,508-line file. This makes the file too large for efficient token usage during development.

The refactoring uses a **Command Registry Pattern**:
- Define `HandlerContext` and `CommandFn` types in `src/command/context.ts`
- Define `createCommandRegistry()` in `src/command/registry.ts` that imports all register functions
- Each command group file exports a `registerXxxCommands(registry)` function and individual handler functions
- Rewrite `src/command/handler.ts` to ~80 lines: `CommandHandler` class that creates a registry, creates a context, and dispatches via registry lookup
- Eliminate `executeDirect` method — `handleExec` will use registry lookup directly
- All 17 test files that import `CommandHandler` must continue to work unchanged

**Critical: Tests MUST pass after refactoring. Run `npm test` to verify.**

### Past failures
None — first attempt.

### Constraints
1. **TypeScript** — all files are `.ts`
2. **Pattern for handler files**: Each file exports:
   - A `registerXxxCommands(registry: Map<string, CommandFn>): void` function that maps command names to handler functions
   - Individual handler functions with signature `(ctx: HandlerContext, args: string[]) => Promise<string> | string`
   - Handler functions use `ctx.storage` instead of `this.storage`, `ctx.pubsub` instead of `this.pubsub`, etc.
3. **HandlerContext must include registry**: Transaction handler (`handleExec`) needs `ctx.registry` to dispatch queued commands
4. **Public API unchanged**: `CommandHandler` constructor signature `(storage, pubsub, connId, send)` and `execute(args)` / `destroy()` methods must remain identical
5. **All 1177 tests must pass**: Run `npm test` to verify
6. **No `executeDirect` duplication**: The current 267-line `executeDirect` method is a near-duplicate of the main switch. In the refactored version, `handleExec` uses `ctx.registry.get()` directly, eliminating this duplication
7. **Shared module-level state**: `slowLog` array and `slowLogId` counter are module-level in current code. Extract to `src/command/slowlog.ts` as module-level exports
8. **`encodeRawArray`** helper function: Currently defined in handler.ts. Move to `src/protocol/resp.ts` as an exported function
9. **Error handling in execute()**: The try/catch in `execute()` catches `WRONGTYPE` errors and returns them as RESP errors. This must be preserved in the slim handler.ts
10. **File size target**: Each handler file should be under 500 lines. The largest groups (string, hash) may be ~400-500 lines
11. **Command groups** (each gets its own file in `src/command/handlers/`):
    - `string-cmds.ts`: PING, ECHO, QUIT, SET, GET, DEL, KEYS, EXISTS, FLUSHDB, FLUSHALL, COMMAND (and sub-commands), MGET, MSET, MSETNX, APPEND, STRLEN, GETRANGE, SETRANGE, INCR, DECR, INCRBY, DECRBY, INCRBYFLOAT, SETNX, SETEX, PSETEX, GETSET, GETDEL, GETEX, LCS
    - `key-cmds.ts`: RENAME, RENAMENX, TYPE, COPY, RANDOMKEY, UNLINK, TOUCH, SCAN, EXPIRE, EXPIREAT, PEXPIRE, PEXPIREAT, TTL, PTTL, PERSIST, EXPIRETIME, PEXPIRETIME, DBSIZE
    - `hash-cmds.ts`: All H* commands (HSET, HGET, HDEL, HGETALL, HKEYS, HVALS, HLEN, HEXISTS, HSETNX, HMSET, HMGET, HINCRBY, HINCRBYFLOAT, HRANDFIELD, HSCAN, HSTRLEN, HGETDEL, HGETEX, HSETEX, HEXPIRE, HEXPIREAT, HPEXPIRE, HPEXPIREAT, HEXPIRETIME, HPEXPIRETIME, HPERSIST, HTTL, HPTTL)
    - `list-cmds.ts`: All L*, R*, BL* commands (LPUSH, RPUSH, LPOP, RPOP, LLEN, LRANGE, LINDEX, LSET, LREM, LTRIM, LPOS, RPOPLPUSH, LPUSHX, RPUSHX, LINSERT, LMOVE, BLPOP, BRPOP, BRPOPLPUSH, BLMOVE, LMPOP)
    - `set-cmds.ts`: All S* commands (SADD, SREM, SMEMBERS, SCARD, SISMEMBER, SMISMEMBER, SRANDMEMBER, SPOP, SMOVE, SDIFF, SINTER, SUNION, SDIFFSTORE, SINTERSTORE, SUNIONSTORE, SINTERCARD, SSCAN)
    - `zset-cmds.ts`: All Z*, BZ* commands (ZADD, ZREM, ZSCORE, ZCARD, ZRANGE, ZREVRANGE, ZRANGEBYSCORE, ZREVRANGEBYSCORE, ZRANGEBYLEX, ZREVRANGEBYLEX, ZRANK, ZREVRANK, ZINCRBY, ZCOUNT, ZREMRANGEBYRANK, ZREMRANGEBYSCORE, ZREMRANGEBYLEX, ZLEXCOUNT, ZSCAN, ZPOPMAX, ZPOPMIN, ZRANDMEMBER, ZMSCORE, ZRANGESTORE, ZDIFF, ZDIFFSTORE, ZUNION, ZUNIONSTORE, ZINTER, ZINTERSTORE, ZINTERCARD, BZPOPMAX, BZPOPMIN, BZMPOP, ZMPOP)
    - `bitmap-cmds.ts`: SETBIT, GETBIT, BITCOUNT, BITPOS, BITOP, BITFIELD, BITFIELD_RO
    - `hll-cmds.ts`: PFADD, PFCOUNT, PFMERGE
    - `json-cmds.ts`: All JSON.* commands (JSON.SET, JSON.GET, JSON.DEL, JSON.FORGET, JSON.TYPE, JSON.STRLEN, JSON.STRAPPEND, JSON.OBJKEYS, JSON.OBJLEN, JSON.ARRAPPEND, JSON.ARRINDEX, JSON.ARRINSERT, JSON.ARRLEN, JSON.ARRPOP, JSON.ARRTRIM, JSON.NUMINCRBY, JSON.NUMMULTBY, JSON.MGET, JSON.MSET, JSON.TOGGLE, JSON.CLEAR, JSON.DEBUG, JSON.RESP, JSON.MERGE)
    - `geo-cmds.ts`: All GEO* commands (GEOADD, GEOHASH, GEOPOS, GEODIST, GEORADIUS, GEORADIUSBYMEMBER, GEOSEARCH, GEOSEARCHSTORE, GEORADIUS_RO, GEORADIUSBYMEMBER_RO)
    - `stream-cmds.ts`: All X* commands (XADD, XTRIM, XDEL, XRANGE, XREVRANGE, XLEN, XREAD, XGROUP with sub-commands, XREADGROUP, XACK, XPENDING, XCLAIM, XAUTOCLAIM, XINFO with sub-commands, XSETID)
    - `pubsub-cmds.ts`: SUBSCRIBE, UNSUBSCRIBE, PSUBSCRIBE, PUNSUBSCRIBE, PUBLISH, SPUBLISH, SSUBSCRIBE, SUNSUBSCRIBE, PUBSUB with sub-commands
    - `transaction-cmds.ts`: MULTI, EXEC, DISCARD, RESET
    - `server-cmds.ts`: INFO, TIME, LASTSAVE, SAVE, SHUTDOWN, CONFIG, SLOWLOG, MEMORY, AUTH, HELLO, SELECT, CLIENT with sub-commands, BGSAVE
    - `sort-cmds.ts`: SORT, SORT_RO
    - `custom-cmds.ts`: DELEX, MSETEX (custom commands not in standard Redis)

### Implementation patterns

**Current pattern** (in handler.ts):
```typescript
private async handleSet(args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'SET' command");
  }
  const key = args[0];
  const value = args[1];
  // ... uses this.storage, this.pubsub, this.connId, this.send
  const existing = await this.storage.get(key);
  await this.storage.set(key, value);
  // ...
}
```

**New pattern** (in handlers/string-cmds.ts):
```typescript
import { HandlerContext, CommandFn } from '../context';
import { encodeSimpleString, encodeError, encodeInteger, encodeBulkString, encodeArray } from '../../protocol/resp';
import type { IStorage } from '../../storage/interface';

export function registerStringCommands(registry: Map<string, CommandFn>): void {
  registry.set('PING', handlePing);
  registry.set('ECHO', handleEcho);
  registry.set('QUIT', handleQuit);
  registry.set('SET', handleSet);
  registry.set('GET', handleGet);
  // ... etc
}

async function handleSet(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'SET' command");
  }
  const key = args[0];
  const value = args[1];
  // ... uses ctx.storage, ctx.pubsub, ctx.connId, ctx.send
  const existing = await ctx.storage.get(key);
  await ctx.storage.set(key, value);
  // ...
}
```

**HandlerContext type** (in context.ts):
```typescript
import type { IStorage } from '../storage/interface';
import type { PubSubManager } from '../pubsub/manager';

export interface HandlerContext {
  storage: IStorage;
  pubsub: PubSubManager;
  connId: string;
  send: (msg: string) => void;
  registry: Map<string, CommandFn>;
  inMulti: boolean;
  multiQueue: string[][];
  clientName: string;
}

export type CommandFn = (ctx: HandlerContext, args: string[]) => Promise<string> | string;
```

**Slim handler.ts** (~80 lines):
```typescript
import { IStorage } from '../storage/interface';
import { PubSubManager } from '../pubsub/manager';
import { HandlerContext, CommandFn } from './context';
import { createCommandRegistry } from './registry';
import { encodeSimpleString, encodeError } from '../protocol/resp';
import { recordSlowLog } from './slowlog';

export class CommandHandler {
  private ctx: HandlerContext;
  private registry: Map<string, CommandFn>;

  constructor(storage: IStorage, pubsub: PubSubManager, connId: string, send: (msg: string) => void) {
    this.registry = createCommandRegistry();
    this.ctx = { storage, pubsub, connId, send, registry: this.registry, inMulti: false, multiQueue: [], clientName: '' };
  }

  destroy(): void {
    this.ctx.pubsub.unsubscribeAll(this.ctx.connId);
  }

  async execute(args: string[]): Promise<string> {
    if (args.length === 0) return encodeError('unknown command');
    const command = args[0].toUpperCase();
    const start = Date.now();
    try {
      if (this.ctx.inMulti) {
        if (command === 'MULTI') return encodeError('MULTI calls can not be nested');
        if (command === 'EXEC' || command === 'DISCARD' || command === 'RESET' || command === 'AUTH' || command === 'HELLO') {
          // fall through to dispatch
        } else {
          this.ctx.multiQueue.push(args);
          return encodeSimpleString('QUEUED');
        }
      }
      const handler = this.registry.get(command);
      if (handler) return await handler(this.ctx, args.slice(1));
      return encodeError(`unknown command '${args[0]}'`);
    } catch (e: any) {
      if (e.message.startsWith('WRONGTYPE')) return `-${e.message}\r\n`;
      return encodeError(e.message);
    } finally {
      recordSlowLog(args, Date.now() - start);
    }
  }
}
```

**slowlog.ts** (extracted module-level state):
```typescript
export interface SlowLogEntry { timestamp: number; command: string[]; duration: number; }
export const slowLog: SlowLogEntry[] = [];
export let slowLogId = 0;
export const SLOWLOG_MAX = 128;
export const SLOWLOG_SLOW_THRESHOLD = 10;

export function recordSlowLog(command: string[], duration: number): void {
  if (duration >= SLOWLOG_SLOW_THRESHOLD) {
    if (slowLog.length >= SLOWLOG_MAX) slowLog.shift();
    slowLog.push({ timestamp: Date.now(), command, duration, id: ++slowLogId });
  }
}
```

**IMPORTANT**: The current `executeDirect` method (lines 867-1133, ~267 lines) is a duplicate of the main switch. It must NOT be replicated. Instead, `handleExec` in `transaction-cmds.ts` should use `ctx.registry.get(command)` to dispatch queued commands.

### Target Files
**New files to CREATE:**
- `src/command/context.ts` — HandlerContext type, CommandFn type, CommandRegistry type
- `src/command/registry.ts` — createCommandRegistry() that imports all registerXxx functions
- `src/command/slowlog.ts` — SlowLogEntry interface and shared state
- `src/command/handlers/string-cmds.ts`
- `src/command/handlers/key-cmds.ts`
- `src/command/handlers/hash-cmds.ts`
- `src/command/handlers/list-cmds.ts`
- `src/command/handlers/set-cmds.ts`
- `src/command/handlers/zset-cmds.ts`
- `src/command/handlers/bitmap-cmds.ts`
- `src/command/handlers/hll-cmds.ts`
- `src/command/handlers/json-cmds.ts`
- `src/command/handlers/geo-cmds.ts`
- `src/command/handlers/stream-cmds.ts`
- `src/command/handlers/pubsub-cmds.ts`
- `src/command/handlers/transaction-cmds.ts`
- `src/command/handlers/server-cmds.ts`
- `src/command/handlers/sort-cmds.ts`
- `src/command/handlers/custom-cmds.ts`

**Files to MODIFY:**
- `src/command/handler.ts` — Rewrite from 5,508 lines to ~80 lines (slim CommandHandler class)
- `src/protocol/resp.ts` — Add `encodeRawArray` function

**Files that must NOT change (imports must still work):**
- `src/server/connection.ts` — imports `CommandHandler` from `../command/handler`
- 17 test files in `src/__tests__/` — all import `CommandHandler` from `../command/handler`

### Signatures
**Current exports from handler.ts:**
```
export class CommandHandler {
  constructor(storage: IStorage, pubsub: PubSubManager, connId: string, send: (msg: string) => void)
  destroy(): void
  execute(args: string[]): Promise<string>
}
```

**Dependencies used by handler methods:**
```
import { IStorage } from '../storage/interface' — 413 lines, full Redis storage interface
import { PubSubManager } from '../pubsub/manager' — 364 lines
import { encodeSimpleString, encodeError, encodeInteger, encodeBulkString, encodeArray } from '../protocol/resp' — 39 lines
```

**Key IStorage methods used (signatures from interface.ts):**
```
get(key: string): Promise<string | null>
set(key: string, value: string): Promise<void>
delete(key: string): Promise<boolean>
keys(pattern: string): Promise<string[]>
flush(): Promise<void>
mget(keys: string[]): Promise<(string | null)[]>
mset(pairs: Array<{ key: string; value: string }>): Promise<void>
incrby(key: string, delta: number): Promise<number>
... (170+ methods defined in IStorage interface)
```

**PubSubManager methods used:**
```
subscribe(connId: string, channels: string[], sendFn: (msg: string) => void): string[]
unsubscribe(connId: string, channels: string[]): string[]
psubscribe(connId: string, patterns: string[], sendFn: (msg: string) => void): string[]
punsubscribe(connId: string, patterns: string[]): string[]
publish(channel: string, message: string): number
ssubscribe(connId: string, channels: string[], sendFn: (msg: string) => void): string[]
sunsubscribe(connId: string, channels: string[]): string[]
getChannels(pattern?: string): string[]
getNumSub(channels: string[]): [string, number][]
getNumPat(): number
unsubscribeAll(connId: string): void
```

**RESP encoding functions used:**
```
encodeSimpleString(str: string): string — src/protocol/resp.ts
encodeError(msg: string): string — src/protocol/resp.ts
encodeInteger(num: number): string — src/protocol/resp.ts
encodeBulkString(str: string | null): string — src/protocol/resp.ts
encodeArray(items: string[] | null): string — src/protocol/resp.ts
encodeRawArray(items: string[]): string — currently in handler.ts, to move to resp.ts
```

---