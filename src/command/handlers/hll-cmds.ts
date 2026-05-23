import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeSimpleString } from '../../protocol/resp';

export function registerHllCommands(registry: Map<string, CommandFn>): void {
  registry.set('PFADD', handlePfadd);
  registry.set('PFCOUNT', handlePfcount);
  registry.set('PFMERGE', handlePfmerge);
}

async function handlePfadd(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'PFADD' command");
  const key = args[0];
  const elements = args.slice(1);
  const result = await ctx.storage.pfadd(key, elements);
  return encodeInteger(result);
}

async function handlePfcount(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'PFCOUNT' command");
  const result = await ctx.storage.pfcount(args);
  return encodeInteger(result);
}

async function handlePfmerge(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'PFMERGE' command");
  const destkey = args[0];
  const sourceKeys = args.slice(1);
  await ctx.storage.pfmerge(destkey, sourceKeys);
  return encodeSimpleString('OK');
}
