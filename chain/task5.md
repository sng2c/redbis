# Task 5: List Commands + Set Commands Handler Modules

## Purpose
Extract list commands and set commands from `src/command/handler.ts` into two handler files.

---

## Part A: `src/command/handlers/list-cmds.ts`

### Source locations in handler.ts (lines 2314–2627)
- `handleLpush` (line 2314)
- `handleRpush` (line 2324)
- `handleLpop` (line 2334)
- `handleRpop` (line 2354)
- `handleLlen` (line 2374)
- `handleLrange` (line 2382)
- `handleLindex` (line 2395)
- `handleLset` (line 2407)
- `handleLrem` (line 2419)
- `handleLtrim` (line 2431)
- `handleLpos` (line 2444)
- `handleRpoplpush` (line 2481)
- `handleLpushx` (line 2489)
- `handleRpushx` (line 2497)
- `handleLinsert` (line 2505)
- `handleLmove` (line 2517)
- `handleBlpop` (line 2530)
- `handleBrpop` (line 2544)
- `handleBrpoplpush` (line 2558)
- `handleBlmove` (line 2570)
- `handleLmpop` (line 2587)

### Template
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

export function registerListCommands(registry: Map<string, CommandFn>): void {
  registry.set('LPUSH', handleLpush);
  registry.set('RPUSH', handleRpush);
  registry.set('LPOP', handleLpop);
  registry.set('RPOP', handleRpop);
  registry.set('LLEN', handleLlen);
  registry.set('LRANGE', handleLrange);
  registry.set('LINDEX', handleLindex);
  registry.set('LSET', handleLset);
  registry.set('LREM', handleLrem);
  registry.set('LTRIM', handleLtrim);
  registry.set('LPOS', handleLpos);
  registry.set('RPOPLPUSH', handleRpoplpush);
  registry.set('LPUSHX', handleLpushx);
  registry.set('RPUSHX', handleRpushx);
  registry.set('LINSERT', handleLinsert);
  registry.set('LMOVE', handleLmove);
  registry.set('BLPOP', handleBlpop);
  registry.set('BRPOP', handleBrpop);
  registry.set('BRPOPLPUSH', handleBrpoplpush);
  registry.set('BLMOVE', handleBlmove);
  registry.set('LMPOP', handleLmpop);
}

// ... handler function bodies
```

### Notes
- `this.storage` → `ctx.storage`
- `handleLmpop` (line 2587) is ~42 lines with complex argument parsing
- `handleLpop` and `handleRpop` handle optional COUNT argument

---

## Part B: `src/command/handlers/set-cmds.ts`

### Source locations in handler.ts (lines 2629–2853)
- `handleSadd` (line 2629)
- `handleSrem` (line 2639)
- `handleSmembers` (line 2649)
- `handleScard` (line 2658)
- `handleSismember` (line 2667)
- `handleSmismember` (line 2677)
- `handleSrandmember` (line 2688)
- `handleSpop` (line 2705)
- `handleSmove` (line 2726)
- `handleSdiff` (line 2737)
- `handleSinter` (line 2746)
- `handleSunion` (line 2755)
- `handleSdiffstore` (line 2764)
- `handleSinterstore` (line 2774)
- `handleSunionstore` (line 2784)
- `handleSintercard` (line 2794)
- `handleSscan` (line 2821)

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

export function registerSetCommands(registry: Map<string, CommandFn>): void {
  registry.set('SADD', handleSadd);
  registry.set('SREM', handleSrem);
  registry.set('SMEMBERS', handleSmembers);
  registry.set('SCARD', handleScard);
  registry.set('SISMEMBER', handleSismember);
  registry.set('SMISMEMBER', handleSmismember);
  registry.set('SRANDMEMBER', handleSrandmember);
  registry.set('SPOP', handleSpop);
  registry.set('SMOVE', handleSmove);
  registry.set('SDIFF', handleSdiff);
  registry.set('SINTER', handleSinter);
  registry.set('SUNION', handleSunion);
  registry.set('SDIFFSTORE', handleSdiffstore);
  registry.set('SINTERSTORE', handleSinterstore);
  registry.set('SUNIONSTORE', handleSunionstore);
  registry.set('SINTERCARD', handleSintercard);
  registry.set('SSCAN', handleSscan);
}

// ... handler function bodies
```

### Notes
- `this.storage` → `ctx.storage`
- `handleSintercard` (line 2794) has ~27 lines with LIMIT parsing

## Verification
- No `this.` references remain
- All handlers have `(ctx: HandlerContext, args: string[])` signature
- All command names registered correctly