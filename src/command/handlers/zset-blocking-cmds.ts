import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeBulkString, encodeArray } from '../../protocol/resp';

export function registerZsetBlockingCommands(registry: Map<string, CommandFn>): void {
  registry.set('BZPOPMAX', handleBzpopmax);
  registry.set('BZPOPMIN', handleBzpopmin);
  registry.set('BZMPOP', handleBzmpop);
  registry.set('ZMPOP', handleZmpop);
}

async function handleBzpopmax(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'BZPOPMAX' command");
  }
  const timeout = parseFloat(args[args.length - 1]);
  if (isNaN(timeout)) {
    return encodeError('ERR timeout is not a float or out of range');
  }
  const keys = args.slice(0, -1);
  const result = await ctx.storage.bzpopmax(keys, timeout);
  if (result === null) return encodeArray(null);
  return encodeArray([result.key, result.member, String(result.score)]);
}

async function handleBzpopmin(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'BZPOPMIN' command");
  }
  const timeout = parseFloat(args[args.length - 1]);
  if (isNaN(timeout)) {
    return encodeError('ERR timeout is not a float or out of range');
  }
  const keys = args.slice(0, -1);
  const result = await ctx.storage.bzpopmin(keys, timeout);
  if (result === null) return encodeArray(null);
  return encodeArray([result.key, result.member, String(result.score)]);
}

async function handleBzmpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'BZMPOP' command");
  }
  const numkeys = parseInt(args[0]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 1 + numkeys + 1) {
    return encodeError("wrong number of arguments for 'BZMPOP' command");
  }
  const keys = args.slice(1, 1 + numkeys);
  let minmax: 'MIN' | 'MAX' | undefined;
  let count: number | undefined;
  for (let i = 1 + numkeys; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'MIN' || opt === 'MAX') {
      minmax = opt as 'MIN' | 'MAX';
    } else if (opt === 'COUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count) || count <= 0)
        return encodeError('ERR value is not an integer or out of range');
    }
  }
  if (!minmax) {
    return encodeError('ERR syntax error');
  }
  const result = await ctx.storage.bzmpop(numkeys, keys, minmax, count);
  if (result === null) return encodeArray(null);
  const keyEncoded = encodeBulkString(result.key);
  const flat: string[] = [];
  for (const e of result.elements) {
    flat.push(e.member, String(e.score));
  }
  const elementsEncoded = encodeArray(flat);
  return `*2\r\n${keyEncoded}${elementsEncoded}`;
}

async function handleZmpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZMPOP' command");
  }
  const numkeys = parseInt(args[0]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 1 + numkeys + 1) {
    return encodeError("wrong number of arguments for 'ZMPOP' command");
  }
  const keys = args.slice(1, 1 + numkeys);
  let minmax: 'MIN' | 'MAX' | undefined;
  let count: number | undefined;
  for (let i = 1 + numkeys; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'MIN' || opt === 'MAX') {
      minmax = opt as 'MIN' | 'MAX';
    } else if (opt === 'COUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count) || count <= 0)
        return encodeError('ERR value is not an integer or out of range');
    }
  }
  if (!minmax) {
    return encodeError('ERR syntax error');
  }
  const result = await ctx.storage.zmpop(numkeys, keys, minmax, count);
  if (result === null) return encodeArray(null);
  const keyEncoded = encodeBulkString(result.key);
  const flat: string[] = [];
  for (const e of result.elements) {
    flat.push(e.member, String(e.score));
  }
  const elementsEncoded = encodeArray(flat);
  return `*2\r\n${keyEncoded}${elementsEncoded}`;
}