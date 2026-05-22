# Task 6: Sorted Set Commands Handler Module

## Purpose
Extract all sorted-set (Z*) and blocking sorted-set (BZ*) command handlers from `src/command/handler.ts` into `src/command/handlers/zset-cmds.ts`.

## Source locations in handler.ts (lines 2853–3720)
This is the largest single handler group (~867 lines). Extract all these methods:

- `handleZadd` (line 2853)
- `handleZrem` (line 2903)
- `handleZscore` (line 2913)
- `handleZcard` (line 2921)
- `handleZrange` (line 2929)
- `handleZrevrange` (line 2972)
- `handleZrangebyscore` (line 2994)
- `handleZrevrangebyscore` (line 3031)
- `handleZrangebylex` (line 3069)
- `handleZrevrangebylex` (line 3097)
- `handleZrank` (line 3126)
- `handleZrevrank` (line 3135)
- `handleZincrby` (line 3144)
- `handleZcount` (line 3156)
- `handleZremrangebyrank` (line 3164)
- `handleZremrangebyscore` (line 3177)
- `handleZremrangebylex` (line 3185)
- `handleZlexcount` (line 3193)
- `handleZscan` (line 3201)
- `handleZpopmax` (line 3231)
- `handleZpopmin` (line 3255)
- `handleZrandmember` (line 3277)
- `handleZmscore` (line 3307)
- `handleZrangestore` (line 3318)
- `handleZdiff` (line 3354)
- `handleZdiffstore` (line 3383)
- `handleZunion` (line 3400)
- `handleZunionstore` (line 3451)
- `handleZinter` (line 3493)
- `handleZinterstore` (line 3544)
- `handleZintercard` (line 3586)
- `handleBzpopmax` (line 3613)
- `handleBzpopmin` (line 3627)
- `handleBzmpop` (line 3641)
- `handleZmpop` (line 3680)

## File to CREATE: `src/command/handlers/zset-cmds.ts`

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

export function registerZsetCommands(registry: Map<string, CommandFn>): void {
  registry.set('ZADD', handleZadd);
  registry.set('ZREM', handleZrem);
  registry.set('ZSCORE', handleZscore);
  registry.set('ZCARD', handleZcard);
  registry.set('ZRANGE', handleZrange);
  registry.set('ZREVRANGE', handleZrevrange);
  registry.set('ZRANGEBYSCORE', handleZrangebyscore);
  registry.set('ZREVRANGEBYSCORE', handleZrevrangebyscore);
  registry.set('ZRANGEBYLEX', handleZrangebylex);
  registry.set('ZREVRANGEBYLEX', handleZrevrangebylex);
  registry.set('ZRANK', handleZrank);
  registry.set('ZREVRANK', handleZrevrank);
  registry.set('ZINCRBY', handleZincrby);
  registry.set('ZCOUNT', handleZcount);
  registry.set('ZREMRANGEBYRANK', handleZremrangebyrank);
  registry.set('ZREMRANGEBYSCORE', handleZremrangebyscore);
  registry.set('ZREMRANGEBYLEX', handleZremrangebylex);
  registry.set('ZLEXCOUNT', handleZlexcount);
  registry.set('ZSCAN', handleZscan);
  registry.set('ZPOPMAX', handleZpopmax);
  registry.set('ZPOPMIN', handleZpopmin);
  registry.set('ZRANDMEMBER', handleZrandmember);
  registry.set('ZMSCORE', handleZmscore);
  registry.set('ZRANGESTORE', handleZrangestore);
  registry.set('ZDIFF', handleZdiff);
  registry.set('ZDIFFSTORE', handleZdiffstore);
  registry.set('ZUNION', handleZunion);
  registry.set('ZUNIONSTORE', handleZunionstore);
  registry.set('ZINTER', handleZinter);
  registry.set('ZINTERSTORE', handleZinterstore);
  registry.set('ZINTERCARD', handleZintercard);
  registry.set('BZPOPMAX', handleBzpopmax);
  registry.set('BZPOPMIN', handleBzpopmin);
  registry.set('BZMPOP', handleBzmpop);
  registry.set('ZMPOP', handleZmpop);
}

// ... all handler bodies copied from handler.ts lines 2853-3720
```

## Transformation Rules
1. `private async handleZadd(args: string[]): Promise<string>` → `async function handleZadd(ctx: HandlerContext, args: string[]): Promise<string>`
2. `this.storage` → `ctx.storage`
3. All Z* handlers use only `ctx.storage` (no pubsub, no connId, etc.)
4. Some return `encodeRawArray(...)` — import `encodeRawArray` from `../../protocol/resp`

## Special Notes
- `handleZadd` (line 2853) is ~50 lines with NX/XX/GT/LT/CH/INCR flag parsing
- `handleZrange` (line 2929) is ~43 lines with BYSCORE/BYLEX/REV option parsing
- `handleZunion` (line 3400) and `handleZinter` (line 3493) are ~50 lines each with WEIGHTS/AGGREGATE parsing
- `handleZmpop` (line 3680) and `handleBzmpop` (line 3641) have complex argument parsing for MIN/MAX/COUNT
- File may be large (~500+ lines). This is acceptable since zset is the most complex data structure.

## Verification
- No `this.` references remain
- All 35 command names registered
- All handler functions have `(ctx: HandlerContext, args: string[])` signature