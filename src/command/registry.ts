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
