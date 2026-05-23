import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeSimpleString } from '../../protocol/resp';

export function registerCustomCommands(registry: Map<string, CommandFn>): void {
  registry.set('DELEX', handleDelex);
  registry.set('MSETEX', handleMsetex);
}

async function handleDelex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'DELEX' command");
  const key = args[0];
  const conditions: Array<{ operator: string; value: string }> = [];
  let i = 1;
  while (i + 2 < args.length) {
    if (args[i].toUpperCase() !== 'IF') {
      i++;
      continue;
    }
    conditions.push({ operator: args[i + 1], value: args[i + 2] });
    i += 3;
  }
  const result = await ctx.storage.delex(key, conditions);
  return encodeInteger(result);
}

async function handleMsetex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3 || args.length % 3 !== 0) {
    return encodeError("wrong number of arguments for 'MSETEX' command");
  }
  const pairs: Array<{ key: string; seconds: number; value: string }> = [];
  for (let i = 0; i < args.length; i += 3) {
    const seconds = parseInt(args[i + 1]);
    if (isNaN(seconds)) return encodeError('ERR value is not an integer or out of range');
    pairs.push({ key: args[i], seconds, value: args[i + 2] });
  }
  const result = await ctx.storage.msetex(pairs);
  return encodeInteger(result);
}
