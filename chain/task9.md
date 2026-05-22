# Task 9: Rewrite `src/command/handler.ts` to Slim Dispatcher

## Purpose
Replace the 5,508-line monolithic `CommandHandler` class with a ~80-line slim dispatcher that delegates to the command registry.

## Depends On
All previous tasks (1-8) must be complete. All handler files and the registry must exist.

## File to REWRITE: `src/command/handler.ts`

The new file should be approximately:

```typescript
import { IStorage } from '../storage/interface';
import { PubSubManager } from '../pubsub/manager';
import { HandlerContext, CommandFn } from './context';
import { createCommandRegistry } from './registry';
import { encodeError, encodeSimpleString } from '../protocol/resp';

export class CommandHandler {
  private storage: IStorage;
  private pubsub: PubSubManager;
  private connId: string;
  private send: (msg: string) => void;
  private registry: Map<string, CommandFn>;

  // Transaction state (mutable)
  private inMulti: boolean = false;
  private multiQueue: string[][] = [];
  private clientName: string = '';

  constructor(storage: IStorage, pubsub: PubSubManager, connId: string, send: (msg: string) => void) {
    this.storage = storage;
    this.pubsub = pubsub;
    this.connId = connId;
    this.send = send;
    this.registry = createCommandRegistry();
  }

  destroy(): void {
    this.pubsub.unsubscribeAll(this.connId);
  }

  async execute(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError('unknown command');
    }

    const command = args[0].toUpperCase();

    // Transaction queuing: when in MULTI, most commands are queued
    if (this.inMulti) {
      if (command === 'MULTI') {
        return encodeError('MULTI calls can not be nested');
      }
      if (command === 'EXEC') {
        return await this.handleExec();
      }
      if (command === 'DISCARD') {
        this.inMulti = false;
        this.multiQueue = [];
        return encodeSimpleString('OK');
      }
      if (command === 'RESET') {
        this.inMulti = false;
        this.multiQueue = [];
        this.pubsub.unsubscribeAll(this.connId);
        return encodeSimpleString('RESET');
      }
      // AUTH and HELLO fall through to dispatch even in MULTI
      if (command !== 'AUTH' && command !== 'HELLO') {
        this.multiQueue.push(args);
        return encodeSimpleString('QUEUED');
      }
    }

    // Commands handled directly (not via registry) because they mutate handler state
    if (command === 'MULTI') {
      this.inMulti = true;
      this.multiQueue = [];
      return encodeSimpleString('OK');
    }
    if (command === 'RESET') {
      this.inMulti = false;
      this.multiQueue = [];
      this.pubsub.unsubscribeAll(this.connId);
      return encodeSimpleString('RESET');
    }

    // Dispatch via registry
    const handler = this.registry.get(command);
    if (!handler) {
      return encodeError(`unknown command '${args[0]}'`);
    }

    const ctx: HandlerContext = {
      storage: this.storage,
      pubsub: this.pubsub,
      connId: this.connId,
      send: this.send,
      registry: this.registry,
      inMulti: this.inMulti,
      multiQueue: this.multiQueue,
      clientName: this.clientName,
    };

    try {
      const result = await handler(ctx, args.slice(1));

      // Post-dispatch: update clientName if CLIENT SETNAME succeeded
      if (command === 'CLIENT' && args.length >= 3 && args[1].toUpperCase() === 'SETNAME') {
        this.clientName = args[2];
      }

      return result;
    } catch (e: any) {
      if (e.message && e.message.startsWith('WRONGTYPE')) {
        return `-${e.message}\r\n`;
      }
      return encodeError(e.message);
    }
  }

  private async handleExec(): Promise<string> {
    if (!this.inMulti) {
      return encodeError('EXEC without MULTI');
    }
    this.inMulti = false;
    const queue = this.multiQueue;
    this.multiQueue = [];
    const results: string[] = [];
    for (const cmdArgs of queue) {
      let result: string;
      try {
        result = await this.execute(cmdArgs);
      } catch (e: any) {
        result = encodeError(e.message);
      }
      results.push(result);
    }
    // Import encodeRawArray from protocol
    const { encodeRawArray } = require('../protocol/resp');
    return encodeRawArray(results);
  }
}
```

**IMPORTANT:** Avoid `require()` — use a proper import at the top:
```typescript
import { encodeError, encodeSimpleString, encodeRawArray } from '../protocol/resp';
```

Then in `handleExec`, just use `encodeRawArray(results)` directly.

### Key design decisions:
1. **`execute()` handles MULTI/EXEC/DISCARD/RESET directly** — these commands mutate handler-internal state (`inMulti`, `multiQueue`) and are NOT dispatched via registry.
2. **`handleExec()` calls `this.execute(cmdArgs)`** for each queued command. This replaces the old `executeDirect()` which duplicated 267 lines. Each queued command now goes through the normal `execute()` path including the registry lookup. The recursive call to `execute()` is safe because `this.inMulti` is already set to `false` at that point.
3. **`HandlerContext` is created fresh for each dispatch** — it's a snapshot of current state. Mutating `ctx.inMulti` won't affect `this.inMulti`. The handler manages its own state directly in `execute()`.
4. **CLIENT SETNAME post-processing** — after the handler returns, if the command was `CLIENT` with `SETNAME` subcommand, update `this.clientName`.
5. **Error handling** — `WRONGTYPE` errors are caught and formatted as `-WRONGTYPE...\r\n`. Other errors use `encodeError()`.
6. **`destroy()`** still calls `this.pubsub.unsubscribeAll(this.connId)`.
7. **Public API unchanged**: `constructor(storage, pubsub, connId, send)`, `execute(args)`, `destroy()`.

### Transaction commands in the registry
Even though MULTI/EXEC/DISCARD/RESET are handled directly in `execute()`, they ARE registered in the registry (by transaction-cmds.ts) so that `COMMAND` and `COMMAND LIST` can enumerate them. The registered handlers are fallback/error handlers that should never actually be invoked through the normal dispatch path.

## Verification
- File is under 100 lines
- Exports `CommandHandler` class with same public API
- No `executeDirect` method exists (duplication eliminated)
- `execute()` dispatches via `this.registry.get(command)`
- Transaction state (`inMulti`, `multiQueue`, `clientName`) managed in `execute()`
- All imports are valid and reference existing modules