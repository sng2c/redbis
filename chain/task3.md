# Task 3: String Commands Handler Module

## Purpose
Extract all "string" group command handlers from `src/command/handler.ts` into `src/command/handlers/string-cmds.ts`.

## Source Reference
Source file: `src/command/handler.ts`

Extract these private methods → standalone exported functions:
- `ping` → `handlePing` (line 414)
- `handleEcho` (line 421)
- `handleQuit` (line 428)
- `handleSet` (line 434)
- `handleGet` (line 552)
- `handleDel` (line 560)
- `handleKeys` (line 572)
- `handleExists` (line 580)
- `handleFlushdb` (line 592)
- `handleCommand` (line 659, includes `getCommandList`, `handleCommandGetkeys`, `handleCommandGetkeysandflags`)
- `handleMget` (line 1239)
- `handleMset` (line 1248)
- `handleMsetnx` (line 1260)
- `handleAppend` (line 1274)
- `handleStrlen` (line 1282)
- `handleGetrange` (line 1290)
- `handleSetrange` (line 1303)
- `handleIncr` (line 1315)
- `handleDecr` (line 1323)
- `handleIncrby` (line 1331)
- `handleDecrby` (line 1343)
- `handleIncrbyfloat` (line 1355)
- `handleSetnx` (line 1369)
- `handleSetex` (line 1377)
- `handlePsetex` (line 1389)
- `handleGetset` (line 1401)
- `handleGetdel` (line 1409)
- `handleGetex` (line 1417)
- `handleLcs` (line 1653)

## Transformation Rules
1. **Signature change:** `private async handleXxx(args: string[]): Promise<string>` → `export async function handleXxx(ctx: HandlerContext, args: string[]): Promise<string>`
2. **`this.storage`** → **`ctx.storage`**
3. **`this.pubsub`** → **`ctx.pubsub`**
4. **`this.connId`** → **`ctx.connId`**
5. **`this.send`** → **`ctx.send`**
6. **`this.inMulti`** → **`ctx.inMulti`** (read-only in these handlers; not mutated)
7. **`this.multiQueue`** → **`ctx.multiQueue`** (not used by string handlers)
8. **`this.clientName`** → **`ctx.clientName`** (not used by string handlers)
9. Helper methods that were private and called only within this group (e.g., `getCommandList`, `handleCommandGetkeys`, `handleCommandGetkeysandflags`) become **non-exported** module-level functions. They do NOT receive `ctx` unless they need it — `getCommandList` is pure, `handleCommandGetkeys`/`handleCommandGetkeysandflags` are pure.
10. `encodeRawArray` calls → import from `../../protocol/resp`.

## File to CREATE: `src/command/handlers/string-cmds.ts`

**Template structure:**

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

export function registerStringCommands(registry: Map<string, CommandFn>): void {
  registry.set('PING', handlePing);
  registry.set('ECHO', handleEcho);
  registry.set('QUIT', handleQuit);
  registry.set('SET', handleSet);
  registry.set('GET', handleGet);
  registry.set('DEL', handleDel);
  registry.set('KEYS', handleKeys);
  registry.set('EXISTS', handleExists);
  registry.set('FLUSHDB', handleFlushdb);
  registry.set('FLUSHALL', handleFlushdb);
  registry.set('COMMAND', handleCommand);
  registry.set('MGET', handleMget);
  registry.set('MSET', handleMset);
  registry.set('MSETNX', handleMsetnx);
  registry.set('APPEND', handleAppend);
  registry.set('STRLEN', handleStrlen);
  registry.set('GETRANGE', handleGetrange);
  registry.set('SETRANGE', handleSetrange);
  registry.set('INCR', handleIncr);
  registry.set('DECR', handleDecr);
  registry.set('INCRBY', handleIncrby);
  registry.set('DECRBY', handleDecrby);
  registry.set('INCRBYFLOAT', handleIncrbyfloat);
  registry.set('SETNX', handleSetnx);
  registry.set('SETEX', handleSetex);
  registry.set('PSETEX', handlePsetex);
  registry.set('GETSET', handleGetset);
  registry.set('GETDEL', handleGetdel);
  registry.set('GETEX', handleGetex);
  registry.set('LCS', handleLcs);
}

// ... handler function bodies extracted from handler.ts with signature & reference transformations
```

## Critical Notes
- **`handleCommand`** at line 659 references `this.getCommandList()` and `encodeRawArray`. Transform: `getCommandList()` becomes a module-scoped function `getCommandList()` (no `this`, pure). The `handleCommandGetkeys` and `handleCommandGetkeysandflags` likewise become module-scoped pure functions.
- **COMMAND DOCS** sub-command returns `encodeArray(null)` — keep as-is.
- **`handleFlushdb`** is registered for both `FLUSHDB` and `FLUSHALL` — same function, two registry entries.
- **`handleGetex`** (line 1417) is one of the longer handlers (~49 lines) — copy it faithfully.
- **`handleLcs`** (line 1653) is ~160 lines with complex LCS algorithm — copy it faithfully with `this.storage` → `ctx.storage` transformations.

## Verification
- Every `this.` reference replaced with `ctx.` where appropriate
- No leftover references to `this.storage`, `this.pubsub`, `this.connId`, `this.send`, `this.inMulti`, `this.multiQueue`, `this.clientName`
- All handler functions have `(ctx: HandlerContext, args: string[])` signature
- `registerStringCommands` sets all 30 command keys listed above