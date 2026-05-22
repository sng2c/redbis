# Task 8: Geo, Stream, PubSub, Transaction, Server, Sort, and Custom Command Handler Modules

## Purpose
Extract the remaining 7 handler groups from `src/command/handler.ts` into their own module files.

---

## Part A: `src/command/handlers/geo-cmds.ts`

### Source locations (lines 4132–4663)
- `handleGeoadd` (line 4134)
- `handleGeohash` (line 4177)
- `handleGeopos` (line 4188)
- `handleGeodist` (line 4203)
- `handleGeoradius` (line 4224)
- `handleGeoradiusbymember` (line 4298)
- `handleGeosearch` (line 4368)
- `handleGeosearchstore` (line 4464)
- `handleGeoradiusRo` (line 4544)
- `handleGeoradiusbymemberRo` (line 4604)

```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerGeoCommands(registry: Map<string, CommandFn>): void {
  registry.set('GEOADD', handleGeoadd);
  registry.set('GEOHASH', handleGeohash);
  registry.set('GEOPOS', handleGeopos);
  registry.set('GEODIST', handleGeodist);
  registry.set('GEORADIUS', handleGeoradius);
  registry.set('GEORADIUSBYMEMBER', handleGeoradiusbymember);
  registry.set('GEOSEARCH', handleGeosearch);
  registry.set('GEOSEARCHSTORE', handleGeosearchstore);
  registry.set('GEORADIUS_RO', handleGeoradiusRo);
  registry.set('GEORADIUSBYMEMBER_RO', handleGeoradiusbymemberRo);
}

// ... handler bodies with this.storage → ctx.storage
```

### Notes
- GEO command handlers are among the longest (georadius ~74 lines, georadiusbymember ~70 lines, geosearch ~96 lines, geosearchstore ~80 lines)
- Import `GeoSearchResult` type from `../../storage/interface` if needed for geo result formatting

---

## Part B: `src/command/handlers/stream-cmds.ts`

### Source locations (lines 4663–5247)
- `handleXadd` (line 4673)
- `handleXtrim` (line 4747)
- `handleXdel` (line 4780)
- `handleXrange` (line 4790)
- `handleXrevrange` (line 4810)
- `handleXlen` (line 4830)
- `handleXread` (line 4838)
- `handleXgroup` (line 4888)
- `handleXreadgroup` (line 4949)
- `handleXack` (line 4998)
- `handleXpending` (line 5007)
- `handleXclaim` (line 5074)
- `handleXautoclaim` (line 5139)
- `handleXinfo` (line 5175)
- `handleXsetid` (line 5237)

**Important:** `handleXgroup` internally dispatches to `handleXgroupCreate`, `handleXgroupDestroy`, `handleXgroupCreateconsumer`, `handleXgroupDelconsumer`, `handleXgroupSetid`. These become private module-level functions. Also `handleXinfo` dispatches to `handleXinfoStream`, `handleXinfoGroups`, `handleXinfoConsumers`.

```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerStreamCommands(registry: Map<string, CommandFn>): void {
  registry.set('XADD', handleXadd);
  registry.set('XTRIM', handleXtrim);
  registry.set('XDEL', handleXdel);
  registry.set('XRANGE', handleXrange);
  registry.set('XREVRANGE', handleXrevrange);
  registry.set('XLEN', handleXlen);
  registry.set('XREAD', handleXread);
  registry.set('XGROUP', handleXgroup);
  registry.set('XREADGROUP', handleXreadgroup);
  registry.set('XACK', handleXack);
  registry.set('XPENDING', handleXpending);
  registry.set('XCLAIM', handleXclaim);
  registry.set('XAUTOCLAIM', handleXautoclaim);
  registry.set('XINFO', handleXinfo);
  registry.set('XSETID', handleXsetid);
}

// ... handler bodies with this.storage → ctx.storage
```

---

## Part C: `src/command/handlers/pubsub-cmds.ts`

### Source locations (lines 740–828)
- `handleSubscribe` (line 740)
- `handleUnsubscribe` (line 746)
- `handlePsubscribe` (line 751)
- `handlePunsubscribe` (line 757)
- `handlePublish` (line 762)
- `handleSpublish` (line 768)
- `handleSsubscribe` (line 774)
- `handleSunsubscribe` (line 780)
- `handlePubsub` (line 785)

```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerPubsubCommands(registry: Map<string, CommandFn>): void {
  registry.set('SUBSCRIBE', handleSubscribe);
  registry.set('UNSUBSCRIBE', handleUnsubscribe);
  registry.set('PSUBSCRIBE', handlePsubscribe);
  registry.set('PUNSUBSCRIBE', handlePunsubscribe);
  registry.set('PUBLISH', handlePublish);
  registry.set('SPUBLISH', handleSpublish);
  registry.set('SSUBSCRIBE', handleSsubscribe);
  registry.set('SUNSUBSCRIBE', handleSunsubscribe);
  registry.set('PUBSUB', handlePubsub);
}

// ... handler bodies
```

### Critical transformation
PubSub handlers use `this.pubsub` and `this.connId` and `this.send`:
- `this.pubsub.subscribe(this.connId, channels, this.send)` → `ctx.pubsub.subscribe(ctx.connId, channels, ctx.send)`
- `this.pubsub.unsubscribe(this.connId, ...)` → `ctx.pubsub.unsubscribe(ctx.connId, ...)`
- `this.pubsub.publish(...)` → `ctx.pubsub.publish(...)`
- `this.pubsub.psubscribe(this.connId, patterns, this.send)` → `ctx.pubsub.psubscribe(ctx.connId, patterns, ctx.send)`
- etc.

---

## Part D: `src/command/handlers/transaction-cmds.ts`

### Source locations (lines 828–1132, specifically the MULTI/EXEC/DISCARD logic)

**CRITICAL:** This is the most important handler group. The `handleExec` method currently duplicates the entire `execute()` switch via `executeDirect()`. In the refactored version, `handleExec` uses `ctx.registry.get()` to look up and dispatch commands, eliminating the 267-line duplication.

```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeRawArray,
} from '../../protocol/resp';

export function registerTransactionCommands(registry: Map<string, CommandFn>): void {
  registry.set('MULTI', handleMulti);
  registry.set('EXEC', handleExec);
  registry.set('DISCARD', handleDiscard);
  registry.set('RESET', handleReset);
}

function handleMulti(ctx: HandlerContext, _args: string[]): string {
  if (ctx.inMulti) {
    return encodeError('MULTI calls can not be nested');
  }
  // NOTE: inMulti and multiQueue are mutable state on the context.
  // The CommandHandler class manages these - transactions mutate ctx directly.
  // However, since ctx is passed by reference via mutable fields on CommandHandler,
  // we need a different approach. See the handler.ts rewrite for how inMulti/multiQueue are managed.
  // For now, the handler returns the signal; CommandHandler.execute() checks/mutates the state.
  return encodeSimpleString('OK');
}

async function handleExec(ctx: HandlerContext, _args: string[]): Promise<string> {
  // Note: actual EXEC state checks and queue management happen in CommandHandler.execute()
  // because inMulti/multiQueue belong to CommandHandler, not ctx.
  // The CommandHandler.execute() method handles the MULTI/EXEC flow directly.
  // This function should never be reached through normal dispatch because
  // execute() handles EXEC specially before looking up the registry.
  return encodeError('EXEC without MULTI');
}

function handleDiscard(ctx: HandlerContext, _args: string[]): string {
  // Same as MULTI - actual state mutation is in CommandHandler.execute()
  return encodeSimpleString('OK');
}

function handleReset(ctx: HandlerContext, _args: string[]): string {
  // Actual RESET logic (clearing inMulti, multiQueue, unsubscribe) is in CommandHandler.execute()
  // because it needs access to mutable state AND pubsub.
  return encodeSimpleString('RESET');
}
```

**IMPORTANT DESIGN DECISION:** Transaction commands (MULTI, EXEC, DISCARD, RESET) need access to mutable state (`inMulti`, `multiQueue`) and side effects (`pubsub.unsubscribeAll`). The cleanest approach for the refactored handler.ts is:

1. **MULTI/DISCARD/RESET are NOT dispatched via registry** — they're handled directly in `CommandHandler.execute()` since they mutate handler-specific state.
2. **EXEC is NOT dispatched via registry** — it's handled directly in `CommandHandler.execute()` because it iterates the multiQueue and dispatches each command via registry lookup.
3. **However**, they ARE still registered in the registry so that `COMMAND` listing and `COMMAND GETKEYS` can find them.

So the actual implementation in transaction-cmds.ts should register them, but the real logic is in `CommandHandler.execute()`. The registered functions can be placeholder implementations that return error messages (since they should never be called directly — `execute()` intercepts them).

**Alternatively**, pass mutable state through a different mechanism. The cleanest approach per the task spec is:

The `HandlerContext` has `inMulti` and `multiQueue` fields. BUT these are read-only snapshots — the actual mutable state lives on `CommandHandler`. So the transaction handlers need to modify `CommandHandler` state.

**SOLUTION:** Make `HandlerContext` carry mutable references (the fields are objects/arrays that can be mutated by reference), AND the `CommandHandler` passes a mutable context where modifying `ctx.inMulti` and `ctx.multiQueue` actually modifies the handler's state. Specifically:
- `ctx.inMulti` is a getter/setter that reads/writes `this._inMulti` on CommandHandler
- OR: `CommandHandler.execute()` handles MULTI/EXEC/DISCARD/RESET directly without delegating to registry, which is the simplest and cleanest approach.

**DECISION:** `CommandHandler.execute()` handles MULTI/EXEC/DISCARD/RESET directly (not through registry). This is how the original code works — the switch in `execute()` handles them, and `executeDirect()` also has special cases for them. The registry entries exist for `COMMAND` listing purposes only.

---

## Part E: `src/command/handlers/server-cmds.ts`

### Source locations
- `handleInfo` (line 1134) — uses `this.storage`
- `handleTime` (line 1140) — pure, no external deps
- `handleLastsave` (line 1147) — uses `this.storage`
- `handleSave` (line 1152) — uses `this.storage`
- `handleShutdown` (line 1157) — pure
- `handleConfig` (line 1161) — uses `slowLog` (import from slowlog module)
- `handleSlowlog` (line 1195) — uses `slowLog` (import from slowlog module)
- `handleMemory` (line 1220) — uses `this.storage`
- `handleAuth` (line 5443) — pure
- `handleHello` (line 5449) — uses `this.connId` → `ctx.connId`
- `handleSelect` (line 5470) — pure
- `handleClient` (line 5475) — uses `this.connId` → `ctx.connId`, `this.clientName` → `ctx.clientName` (but also SETS clientName — needs special handling)
- `handleBgsave` (line 5437) — uses `this.storage`

```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
  encodeRawArray,
} from '../../protocol/resp';
import { slowLog, SLOWLOG_MAX } from '../slowlog';

export function registerServerCommands(registry: Map<string, CommandFn>): void {
  registry.set('INFO', handleInfo);
  registry.set('TIME', handleTime);
  registry.set('LASTSAVE', handleLastsave);
  registry.set('SAVE', handleSave);
  registry.set('SHUTDOWN', handleShutdown);
  registry.set('CONFIG', handleConfig);
  registry.set('SLOWLOG', handleSlowlog);
  registry.set('MEMORY', handleMemory);
  registry.set('AUTH', handleAuth);
  registry.set('HELLO', handleHello);
  registry.set('SELECT', handleSelect);
  registry.set('CLIENT', handleClient);
  registry.set('BGSAVE', handleBgsave);
}

// ... handler bodies
```

### Critical Notes for server-cmds.ts

1. **`handleConfig`** — The `CONFIG RESETSTAT` sub-command does `slowLog.length = 0`. Import `slowLog` from `../slowlog` module.
2. **`handleSlowlog`** — Reads `slowLog` and references `slowLogId`. Import both from `../slowlog`.
3. **`handleHello`** — References `this.connId` → `ctx.connId`.
4. **`handleClient`** — Has `case 'SETNAME':` that sets `this.clientName = args[1]`. Since `ctx.clientName` is a string (primitive), it CANNOT be mutated through the context. **Solution:** The `HandlerContext` must support a way to update clientName. The simplest approach: add a `setClientName(name: string)` callback to `HandlerContext`, OR handle CLIENT SETNAME in `CommandHandler.execute()` directly. **RECOMMENDED:** Add `clientName` as a writable field and use a mutable container pattern — the CommandHandler will update its own `clientName` after dispatch if the result indicates success. Actually, the simplest approach: make `ctx.clientName` a property that reads from the handler, and for CLIENT SETNAME, the handler post-processes the result.

   **FINAL DECISION:** `handleClient` returns a special response. The `CommandHandler.execute()` method checks if the command is `CLIENT` and subcommand is `SETNAME`, and after dispatching, updates `this.clientName`. This is a small special case in the execute() method.

5. **`handleInfo`** — calls `this.storage.info(section)` → `ctx.storage.info(section)`

---

## Part F: `src/command/handlers/sort-cmds.ts`

### Source locations (lines 5247–5404)
- `handleSort` (line 5247)
- `handleSortRo` (line 5323)

```typescript
import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeArray } from '../../protocol/resp';

export function registerSortCommands(registry: Map<string, CommandFn>): void {
  registry.set('SORT', handleSort);
  registry.set('SORT_RO', handleSortRo);
}

// ... handler bodies with this.storage → ctx.storage
```

---

## Part G: `src/command/handlers/custom-cmds.ts`

### Source locations (lines 5403–5437)
- `handleDelex` (line 5404)
- `handleMsetex` (line 5422)

```typescript
import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeSimpleString } from '../../protocol/resp';

export function registerCustomCommands(registry: Map<string, CommandFn>): void {
  registry.set('DELEX', handleDelex);
  registry.set('MSETEX', handleMsetex);
}

// ... handler bodies with this.storage → ctx.storage
```

---

## Verification for all 7 files
- No `this.` references remain — all replaced with `ctx.` equivalents
- All handlers have `(ctx: HandlerContext, args: string[])` signature
- SlowLog references in server-cmds.ts import from `../slowlog`
- PubSub handlers use `ctx.pubsub`, `ctx.connId`, `ctx.send`
- Transaction commands registered but logic handled in CommandHandler.execute()
- CLIENT SETNAME special case: handler returns successful response; CommandHandler.execute() checks and updates state post-dispatch