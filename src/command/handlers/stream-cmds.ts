import { CommandFn } from '../context';
import { registerStreamBasicCommands } from './stream-basic-cmds';
import { registerStreamGroupCommands } from './stream-group-cmds';

export function registerStreamCommands(registry: Map<string, CommandFn>): void {
  registerStreamBasicCommands(registry);
  registerStreamGroupCommands(registry);
}