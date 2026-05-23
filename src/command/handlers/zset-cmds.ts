import { CommandFn } from '../context';
import { registerZsetBasicCommands } from './zset-basic-cmds';
import { registerZsetUnionCommands } from './zset-union-cmds';
import { registerZsetBlockingCommands } from './zset-blocking-cmds';

export function registerZsetCommands(registry: Map<string, CommandFn>): void {
  registerZsetBasicCommands(registry);
  registerZsetUnionCommands(registry);
  registerZsetBlockingCommands(registry);
}