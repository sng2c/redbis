# Task 2: Command Registry

## Purpose
Create the registry factory function that assembles all command handlers into a `Map<string, CommandFn>`.

## Depends On
- Task 1 (context.ts must exist for the `CommandFn` type)

## File to CREATE: `src/command/registry.ts`

```typescript
import { CommandFn } from './context';
import { registerStringCommands } from './handlers/string-cmds';
import { registerKeyCommands } from './handlers/key-cmds';
import { registerHashCommands } from './handlers/hash-cmds';
import { registerListCommands } from './handlers/list-cmds';
import { registerSetCommands } from './handlers/set-cmds';
import { registerZsetCommands } from './handlers/zset-cmds';
import { registerBitmapCommands } from './handlers/bitmap-cmds';
import { registerHllCommands } from './handlers/hll-cmds';
import { registerJsonCommands } from './handlers/json-cmds';
import { registerGeoCommands } from './handlers/geo-cmds';
import { registerStreamCommands } from './handlers/stream-cmds';
import { registerPubsubCommands } from './handlers/pubsub-cmds';
import { registerTransactionCommands } from './handlers/transaction-cmds';
import { registerServerCommands } from './handlers/server-cmds';
import { registerSortCommands } from './handlers/sort-cmds';
import { registerCustomCommands } from './handlers/custom-cmds';

export function createCommandRegistry(): Map<string, CommandFn> {
  const registry = new Map<string, CommandFn>();
  registerStringCommands(registry);
  registerKeyCommands(registry);
  registerHashCommands(registry);
  registerListCommands(registry);
  registerSetCommands(registry);
  registerZsetCommands(registry);
  registerBitmapCommands(registry);
  registerHllCommands(registry);
  registerJsonCommands(registry);
  registerGeoCommands(registry);
  registerStreamCommands(registry);
  registerPubsubCommands(registry);
  registerTransactionCommands(registry);
  registerServerCommands(registry);
  registerSortCommands(registry);
  registerCustomCommands(registry);
  return registry;
}
```

## Notes
- Each `registerXxxCommands` function receives the mutable `Map<string, CommandFn>` and calls `registry.set('COMMAND_NAME', handlerFunction)` for each command it owns.
- This file will not compile until all 16 handler files exist. That's expected — Workers 3-8 create those files.

## Verification
- File imports `CommandFn` from `./context`
- File imports all 16 `registerXxxCommands` from `./handlers/*-cmds`
- `createCommandRegistry()` returns `Map<string, CommandFn>`