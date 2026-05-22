# Task 10: Test Verification and Integration

## Purpose
Verify that all 1177 tests pass after the refactoring. Fix any issues found.

## Prerequisites
All tasks 1-9 must be complete. The new file structure should be:

```
src/command/
  context.ts          (HandlerContext, CommandFn types)
  slowlog.ts          (SlowLogEntry, slowLog, slowLogId, SLOWLOG_MAX, SLOWLOG_SLOW_THRESHOLD)
  registry.ts          (createCommandRegistry function)
  handler.ts           (slim CommandHandler, ~80 lines)
  handlers/
    string-cmds.ts
    key-cmds.ts
    hash-cmds.ts
    list-cmds.ts
    set-cmds.ts
    zset-cmds.ts
    bitmap-cmds.ts
    hll-cmds.ts
    json-cmds.ts
    geo-cmds.ts
    stream-cmds.ts
    pubsub-cmds.ts
    transaction-cmds.ts
    server-cmds.ts
    sort-cmds.ts
    custom-cmds.ts
src/protocol/
  resp.ts             (now includes encodeRawArray)
```

## Test Commands
```bash
npx vitest run
```

All 1177 tests across 17+ test files must pass. All test files import `CommandHandler` from `../command/handler` — this import path must still work.

## Common Issues to Check

1. **`encodeRawArray` not found** — Ensure `src/protocol/resp.ts` exports it and all handler files import it correctly.

2. **`this.` references in handler files** — Search all handler files for remaining `this.` references. They should all be replaced with `ctx.` equivalents.

3. **Transaction state in context** — `HandlerContext.inMulti` and `HandlerContext.multiQueue` are read-only snapshots. The `CommandHandler.execute()` method manages the real mutable state. Make sure no handler tries to set `ctx.inMulti = true` (except maybe in transaction-cmds.ts where it's a no-op since execute() handles it).

4. **`slowLog` and `slowLogId` module-level state** — In the original code these were module-level variables in `handler.ts`. They must now be imported from `src/command/slowlog.ts`. In `server-cmds.ts`:
   - `import { slowLog, SLOWLOG_MAX } from '../slowlog';`
   - `handleConfig` with RESETSTAT: `slowLog.length = 0;`
   - `handleSlowlog`: reads from `slowLog`

5. **`clientName` mutation** — In the original `handleClient`, `this.clientName = args[1]` was used. In the refactored version, `CommandHandler.execute()` post-processes CLIENT SETNAME commands.

6. **Circular imports** — If `registry.ts` imports all handler modules, and handler modules import from `context.ts`, and `context.ts` has no circular dependencies, we're fine.

7. **`getCommandList()`** — This method was on `CommandHandler` and is used by `handleCommand`. It returns a hardcoded list of all command names. In the refactored version, it becomes a module-level function in `string-cmds.ts`. Make sure it lists ALL command names including the ones from other groups, OR replace it with `Array.from(registry.keys())`. **RECOMMENDED:** Replace the hardcoded list with `Array.from(ctx.registry.keys())` in `handleCommand` so it dynamically reflects all registered commands.

8. **`handleCommandGetkeys` / `handleCommandGetkeysandflags`** — These are helper functions called only by `handleCommand`. They should be private module-level functions in `string-cmds.ts`.

9. **TypeScript compilation** — Run `npx tsc --noEmit` to check for type errors before running tests.

10. **`args.slice(1)` consistency** — In the original code, the `execute()` method passes `args.slice(1)` to handlers. In the refactored registry dispatch, `handler(ctx, args.slice(1))` should be consistent. Check that `CommandHandler.execute()` does `handler(ctx, args.slice(1))`.

## Fix Process
If tests fail:
1. Identify which test files fail
2. Read the failure messages carefully
3. Check the corresponding handler file for incorrect `this.` → `ctx.` transformations
4. Check that all command names are correctly registered in their respective `registerXxxCommands` function
5. If a command returns unexpected results, compare the handler implementation with the original `handler.ts`
6. Fix and re-run tests