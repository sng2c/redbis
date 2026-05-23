import { CommandFn } from '../context';
import { registerStringConnectionCommands } from './string-connection-cmds';
import { registerStringOpsCommands } from './string-ops-cmds';

export function registerStringCommands(registry: Map<string, CommandFn>): void {
  registerStringConnectionCommands(registry);
  registerStringOpsCommands(registry);
}