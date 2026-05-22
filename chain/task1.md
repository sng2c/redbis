# Task 1: Foundation Layer — Types, SlowLog Module, and encodeRawArray

## Purpose
Create the shared types and utilities that all handler files depend on.

## Files to CREATE

### 1. `src/command/context.ts`

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

### 2. `src/command/slowlog.ts`

Extract the slow-log state from the top of `src/command/handler.ts` (lines 17-21):

```
interface SlowLogEntry { timestamp: number; command: string[]; duration: number; }
const slowLog: SlowLogEntry[] = [];
let slowLogId = 0;
const SLOWLOG_MAX = 128;
const SLOWLOG_SLOW_THRESHOLD = 10; // ms
```

Create `src/command/slowlog.ts`:

```typescript
export interface SlowLogEntry {
  timestamp: number;
  command: string[];
  duration: number;
}

export const slowLog: SlowLogEntry[] = [];
export let slowLogId = 0;
export const SLOWLOG_MAX = 128;
export const SLOWLOG_SLOW_THRESHOLD = 10; // ms
```

**IMPORTANT:** Use `export` on all items. `slowLogId` must be `let` (it gets incremented). The `CONFIG RESETSTAT` handler resets `slowLog.length = 0`, and `SLOWLOG GET` reads from `slowLog`. Both will import from this module.

## Files to MODIFY

### 3. `src/protocol/resp.ts`

Add the `encodeRawArray` function at the end of the file. This function is currently a private utility at line 23 of `handler.ts`:

```
function encodeRawArray(items: string[]): string {
  return `*${items.length}\r\n${items.join('')}`;
}
```

Add it as an **exported** function in `src/protocol/resp.ts`:

```typescript
export function encodeRawArray(items: string[]): string {
  return `*${items.length}\r\n${items.join('')}`;
}
```

## Verification
- `src/command/context.ts` exports `HandlerContext` and `CommandFn`
- `src/command/slowlog.ts` exports `SlowLogEntry`, `slowLog`, `slowLogId`, `SLOWLOG_MAX`, `SLOWLOG_SLOW_THRESHOLD`
- `src/protocol/resp.ts` now also exports `encodeRawArray`
- No `import` of handler.ts — these modules are leaf dependencies