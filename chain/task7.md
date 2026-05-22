# Task 7: Bitmap, HLL, and JSON Command Handler Modules

## Purpose
Extract three handler groups from `src/command/handler.ts` into their own module files.

---

## Part A: `src/command/handlers/bitmap-cmds.ts`

### Source locations (lines 3721–3876)
- `handleSetbit` (line 3721)
- `handleGetbit` (line 3732)
- `handleBitcount` (line 3740)
- `handleBitpos` (line 3756)
- `handleBitop` (line 3774)
- `handleBitfield` (line 3785)
- `handleBitfieldRo` (line 3849)

```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerBitmapCommands(registry: Map<string, CommandFn>): void {
  registry.set('SETBIT', handleSetbit);
  registry.set('GETBIT', handleGetbit);
  registry.set('BITCOUNT', handleBitcount);
  registry.set('BITPOS', handleBitpos);
  registry.set('BITOP', handleBitop);
  registry.set('BITFIELD', handleBitfield);
  registry.set('BITFIELD_RO', handleBitfieldRo);
}

// ... handler bodies with this.storage → ctx.storage
```

### Notes
- `handleBitfield` (line 3785) is ~64 lines with complex BIT/SET/INCRBY operation parsing
- `handleBitfieldRo` (line 3849) is ~28 lines

---

## Part B: `src/command/handlers/hll-cmds.ts`

### Source locations (lines 3877–3897)
- `handlePfadd` (line 3877)
- `handlePfcount` (line 3885)
- `handlePfmerge` (line 3891)

```typescript
import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeSimpleString } from '../../protocol/resp';

export function registerHllCommands(registry: Map<string, CommandFn>): void {
  registry.set('PFADD', handlePfadd);
  registry.set('PFCOUNT', handlePfcount);
  registry.set('PFMERGE', handlePfmerge);
}

// ... handler bodies with this.storage → ctx.storage
```

---

## Part C: `src/command/handlers/json-cmds.ts`

### Source locations (lines 3899–4132)
- `handleJsonSet` (line 3901)
- `handleJsonGet` (line 3918)
- `handleJsonDel` (line 3926)
- `handleJsonForget` (line 3933)
- `handleJsonType` (line 3937)
- `handleJsonStrlen` (line 3945)
- `handleJsonStrappend` (line 3953)
- `handleJsonObjkeys` (line 3963)
- `handleJsonObjlen` (line 3971)
- `handleJsonArrappend` (line 3979)
- `handleJsonArrindex` (line 3989)
- `handleJsonArrinsert` (line 4003)
- `handleJsonArrlen` (line 4015)
- `handleJsonArrpop` (line 4023)
- `handleJsonArrtrim` (line 4037)
- `handleJsonNumincrby` (line 4049)
- `handleJsonNummultby` (line 4059)
- `handleJsonMget` (line 4069)
- `handleJsonMset` (line 4078)
- `handleJsonToggle` (line 4088)
- `handleJsonClear` (line 4096)
- `handleJsonDebug` (line 4103)
- `handleJsonResp` (line 4115)
- `handleJsonMerge` (line 4123)

```typescript
import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerJsonCommands(registry: Map<string, CommandFn>): void {
  registry.set('JSON.SET', handleJsonSet);
  registry.set('JSON.GET', handleJsonGet);
  registry.set('JSON.DEL', handleJsonDel);
  registry.set('JSON.FORGET', handleJsonForget);
  registry.set('JSON.TYPE', handleJsonType);
  registry.set('JSON.STRLEN', handleJsonStrlen);
  registry.set('JSON.STRAPPEND', handleJsonStrappend);
  registry.set('JSON.OBJKEYS', handleJsonObjkeys);
  registry.set('JSON.OBJLEN', handleJsonObjlen);
  registry.set('JSON.ARRAPPEND', handleJsonArrappend);
  registry.set('JSON.ARRINDEX', handleJsonArrindex);
  registry.set('JSON.ARRINSERT', handleJsonArrinsert);
  registry.set('JSON.ARRLEN', handleJsonArrlen);
  registry.set('JSON.ARRPOP', handleJsonArrpop);
  registry.set('JSON.ARRTRIM', handleJsonArrtrim);
  registry.set('JSON.NUMINCRBY', handleJsonNumincrby);
  registry.set('JSON.NUMMULTBY', handleJsonNummultby);
  registry.set('JSON.MGET', handleJsonMget);
  registry.set('JSON.MSET', handleJsonMset);
  registry.set('JSON.TOGGLE', handleJsonToggle);
  registry.set('JSON.CLEAR', handleJsonClear);
  registry.set('JSON.DEBUG', handleJsonDebug);
  registry.set('JSON.RESP', handleJsonResp);
  registry.set('JSON.MERGE', handleJsonMerge);
}

// ... handler bodies with this.storage → ctx.storage
```

### Notes
- JSON command names contain dots: `'JSON.SET'`, `'JSON.GET'`, etc.
- `handleJsonArrindex` (line 3989) has optional start/stop parameters
- Most JSON handlers are short (10-20 lines)

## Verification for all three files
- No `this.` references remain
- All handlers have `(ctx: HandlerContext, args: string[])` signature
- All command names in registry match original switch cases exactly (including dotted names like `JSON.SET`)