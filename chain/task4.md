# Task 4: Key Commands + Hash Commands Handler Modules

## Purpose
Extract key-management commands and hash commands from `src/command/handler.ts` into two separate handler files.

---

## Part A: `src/command/handlers/key-cmds.ts`

### Source locations in handler.ts
- `handleRename` (line 1466)
- `handleRenamenx` (line 1478)
- `handleType` (line 1490)
- `handleDbsize` (line 1498)
- `handleCopy` (line 1503)
- `handleRandomkey` (line 1511)
- `handleUnlink` (line 1516)
- `handleTouch` (line 1524)
- `handleScan` (line 1532)
- `handleExpire` (line 1563)
- `handleExpireat` (line 1575)
- `handlePexpire` (line 1587)
- `handlePexpireat` (line 1599)
- `handleTtl` (line 1611)
- `handlePttl` (line 1619)
- `handlePersist` (line 1627)
- `handleExpiretime` (line 1635)
- `handlePexpiretime` (line 1643)

### Template
```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerKeyCommands(registry: Map<string, CommandFn>): void {
  registry.set('RENAME', handleRename);
  registry.set('RENAMENX', handleRenamenx);
  registry.set('TYPE', handleType);
  registry.set('DBSIZE', handleDbsize);
  registry.set('COPY', handleCopy);
  registry.set('RANDOMKEY', handleRandomkey);
  registry.set('UNLINK', handleUnlink);
  registry.set('TOUCH', handleTouch);
  registry.set('SCAN', handleScan);
  registry.set('EXPIRE', handleExpire);
  registry.set('EXPIREAT', handleExpireat);
  registry.set('PEXPIRE', handlePexpire);
  registry.set('PEXPIREAT', handlePexpireat);
  registry.set('TTL', handleTtl);
  registry.set('PTTL', handlePttl);
  registry.set('PERSIST', handlePersist);
  registry.set('EXPIRETIME', handleExpiretime);
  registry.set('PEXPIRETIME', handlePexpiretime);
}

// ... copied handler bodies with this.storage → ctx.storage etc.
```

### Transformation Notes
- `this.storage` → `ctx.storage` for all handlers
- `handleScan` (line 1532) is ~31 lines with cursor/pattern logic
- `DBSIZE` was in the original `execute()` switch under both "server" section but in the spec it belongs to key-cmds — register it here

---

## Part B: `src/command/handlers/hash-cmds.ts`

### Source locations in handler.ts
All H* commands (lines 1813–2312):
- `handleHset` (line 1826)
- `handleHget` (line 1834)
- `handleHdel` (line 1844)
- `handleHgetall` (line 1856)
- `handleHkeys` (line 1864)
- `handleHvals` (line 1872)
- `handleHlen` (line 1880)
- `handleHexists` (line 1880)
- `handleHsetnx` (line 1888)
- `handleHmset` (line 1896)
- `handleHmget` (line 1909)
- `handleHincrby` (line 1920)
- `handleHincrbyfloat` (line 1932)
- `handleHrandfield` (line 1944)
- `handleHscan` (line 1985)
- `handleHstrlen` (line 2021)
- `handleHgetdel` (line 2029)
- `handleHgetex` (line 2040)
- `handleHsetex` (line 2108)
- `handleHexpire` (line 2182)
- `handleHexpireat` (line 2202)
- `handleHpexpire` (line 2222)
- `handleHpexpireat` (line 2242)
- `handleHexpiretime` (line 2262)
- `handleHpexpiretime` (line 2272)
- `handleHpersist` (line 2282)
- `handleHttl` (line 2292)
- `handleHpttl` (line 2302)

### Template
```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerHashCommands(registry: Map<string, CommandFn>): void {
  registry.set('HSET', handleHset);
  registry.set('HGET', handleHget);
  registry.set('HDEL', handleHdel);
  registry.set('HGETALL', handleHgetall);
  registry.set('HKEYS', handleHkeys);
  registry.set('HVALS', handleHvals);
  registry.set('HLEN', handleHlen);
  registry.set('HEXISTS', handleHexists);
  registry.set('HSETNX', handleHsetnx);
  registry.set('HMSET', handleHmset);
  registry.set('HMGET', handleHmget);
  registry.set('HINCRBY', handleHincrby);
  registry.set('HINCRBYFLOAT', handleHincrbyfloat);
  registry.set('HRANDFIELD', handleHrandfield);
  registry.set('HSCAN', handleHscan);
  registry.set('HSTRLEN', handleHstrlen);
  registry.set('HGETDEL', handleHgetdel);
  registry.set('HGETEX', handleHgetex);
  registry.set('HSETEX', handleHsetex);
  registry.set('HEXPIRE', handleHexpire);
  registry.set('HEXPIREAT', handleHexpireat);
  registry.set('HPEXPIRE', handleHpexpire);
  registry.set('HPEXPIREAT', handleHpexpireat);
  registry.set('HEXPIRETIME', handleHexpiretime);
  registry.set('HPEXPIRETIME', handleHpexpiretime);
  registry.set('HPERSIST', handleHpersist);
  registry.set('HTTL', handleHttl);
  registry.set('HPTTL', handleHpttl);
}

// ... copied handler bodies with this.storage → ctx.storage etc.
```

### Transformation Notes
- `handleHgetex` (line 2040) and `handleHsetex` (line 2108) are long handlers (~68 and ~74 lines). Copy them faithfully.
- All `this.storage` → `ctx.storage`
- `handleHmset` uses `ctx.storage.hset` internally

## Verification for both files
- No `this.` references remain (all replaced with `ctx.` equivalents)
- Each handler has `(ctx: HandlerContext, args: string[])` signature
- Each registration function maps all command names to their handlers