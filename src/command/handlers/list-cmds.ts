import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerListCommands(registry: Map<string, CommandFn>): void {
  registry.set('LPUSH', handleLpush);
  registry.set('RPUSH', handleRpush);
  registry.set('LPOP', handleLpop);
  registry.set('RPOP', handleRpop);
  registry.set('LLEN', handleLlen);
  registry.set('LRANGE', handleLrange);
  registry.set('LINDEX', handleLindex);
  registry.set('LSET', handleLset);
  registry.set('LREM', handleLrem);
  registry.set('LTRIM', handleLtrim);
  registry.set('LPOS', handleLpos);
  registry.set('RPOPLPUSH', handleRpoplpush);
  registry.set('LPUSHX', handleLpushx);
  registry.set('RPUSHX', handleRpushx);
  registry.set('LINSERT', handleLinsert);
  registry.set('LMOVE', handleLmove);
  registry.set('BLPOP', handleBlpop);
  registry.set('BRPOP', handleBrpop);
  registry.set('BRPOPLPUSH', handleBrpoplpush);
  registry.set('BLMOVE', handleBlmove);
  registry.set('LMPOP', handleLmpop);
}

async function handleLpush(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'LPUSH' command");
  }
  const key = args[0];
  const elements = args.slice(1);
  const result = await ctx.storage.lpush(key, elements);
  return encodeInteger(result);
}

async function handleRpush(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'RPUSH' command");
  }
  const key = args[0];
  const elements = args.slice(1);
  const result = await ctx.storage.rpush(key, elements);
  return encodeInteger(result);
}

async function handleLpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1 || args.length > 2) {
    return encodeError("wrong number of arguments for 'LPOP' command");
  }
  const key = args[0];
  if (args.length === 2) {
    const count = parseInt(args[1]);
    if (isNaN(count) || count < 0) {
      return encodeError('ERR value is not an integer or out of range');
    }
    if (count === 0) return encodeArray([]);
    const result = await ctx.storage.lpop(key, count);
    if (result === null) return encodeArray(null);
    return encodeArray(result as string[]);
  }
  const result = await ctx.storage.lpop(key);
  if (result === null) return encodeBulkString(null);
  return encodeBulkString(result as string);
}

async function handleRpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1 || args.length > 2) {
    return encodeError("wrong number of arguments for 'RPOP' command");
  }
  const key = args[0];
  if (args.length === 2) {
    const count = parseInt(args[1]);
    if (isNaN(count) || count < 0) {
      return encodeError('ERR value is not an integer or out of range');
    }
    if (count === 0) return encodeArray([]);
    const result = await ctx.storage.rpop(key, count);
    if (result === null) return encodeArray(null);
    return encodeArray(result as string[]);
  }
  const result = await ctx.storage.rpop(key);
  if (result === null) return encodeBulkString(null);
  return encodeBulkString(result as string);
}

async function handleLlen(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'LLEN' command");
  }
  const result = await ctx.storage.llen(args[0]);
  return encodeInteger(result);
}

async function handleLrange(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'LRANGE' command");
  }
  const start = parseInt(args[1]);
  const stop = parseInt(args[2]);
  if (isNaN(start) || isNaN(stop)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.lrange(args[0], start, stop);
  return encodeArray(result);
}

async function handleLindex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'LINDEX' command");
  }
  const index = parseInt(args[1]);
  if (isNaN(index)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.lindex(args[0], index);
  return encodeBulkString(result);
}

async function handleLset(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'LSET' command");
  }
  const index = parseInt(args[1]);
  if (isNaN(index)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  await ctx.storage.lset(args[0], index, args[2]);
  return encodeSimpleString('OK');
}

async function handleLrem(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'LREM' command");
  }
  const count = parseInt(args[1]);
  if (isNaN(count)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.lrem(args[0], count, args[2]);
  return encodeInteger(result);
}

async function handleLtrim(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'LTRIM' command");
  }
  const start = parseInt(args[1]);
  const stop = parseInt(args[2]);
  if (isNaN(start) || isNaN(stop)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  await ctx.storage.ltrim(args[0], start, stop);
  return encodeSimpleString('OK');
}

async function handleLpos(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'LPOS' command");
  }
  const key = args[0];
  const element = args[1];
  let rank: number | undefined;
  let maxlen: number | undefined;

  for (let i = 2; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'RANK') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      rank = parseInt(args[i]);
      if (isNaN(rank) || rank === 0) return encodeError('ERR value is not an integer or out of range');
    } else if (opt === 'MAXLEN') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      maxlen = parseInt(args[i]);
      if (isNaN(maxlen) || maxlen <= 0) return encodeError('ERR value is not an integer or out of range');
    } else if (opt === 'FIRST') {
      if (rank === undefined) rank = 1;
    } else {
      return encodeError('ERR syntax error');
    }
  }

  const options: { rank?: number; maxlen?: number } = {};
  if (rank !== undefined) options.rank = rank;
  if (maxlen !== undefined) options.maxlen = maxlen;

  const result = await ctx.storage.lpos(key, element, options);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleRpoplpush(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'RPOPLPUSH' command");
  }
  const result = await ctx.storage.rpoplpush(args[0], args[1]);
  return encodeBulkString(result);
}

async function handleLpushx(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'LPUSHX' command");
  }
  const result = await ctx.storage.lpushx(args[0], args[1]);
  return encodeInteger(result);
}

async function handleRpushx(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'RPUSHX' command");
  }
  const result = await ctx.storage.rpushx(args[0], args[1]);
  return encodeInteger(result);
}

async function handleLinsert(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 4) {
    return encodeError("wrong number of arguments for 'LINSERT' command");
  }
  const position = args[1].toUpperCase();
  if (position !== 'BEFORE' && position !== 'AFTER') {
    return encodeError('ERR syntax error');
  }
  const result = await ctx.storage.linsert(args[0], position as 'BEFORE' | 'AFTER', args[2], args[3]);
  return encodeInteger(result);
}

async function handleLmove(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 4) {
    return encodeError("wrong number of arguments for 'LMOVE' command");
  }
  const srcDir = args[2].toUpperCase();
  const destDir = args[3].toUpperCase();
  if ((srcDir !== 'LEFT' && srcDir !== 'RIGHT') || (destDir !== 'LEFT' && destDir !== 'RIGHT')) {
    return encodeError('ERR syntax error');
  }
  const result = await ctx.storage.lmove(args[0], args[1], srcDir as 'LEFT' | 'RIGHT', destDir as 'LEFT' | 'RIGHT');
  return encodeBulkString(result);
}

async function handleBlpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'BLPOP' command");
  }
  const timeout = parseFloat(args[args.length - 1]);
  if (isNaN(timeout)) {
    return encodeError('ERR timeout is not a float or out of range');
  }
  const keys = args.slice(0, -1);
  const result = await ctx.storage.blpop(keys, timeout);
  if (result === null) return encodeArray(null);
  return encodeArray([result.key, result.element]);
}

async function handleBrpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'BRPOP' command");
  }
  const timeout = parseFloat(args[args.length - 1]);
  if (isNaN(timeout)) {
    return encodeError('ERR timeout is not a float or out of range');
  }
  const keys = args.slice(0, -1);
  const result = await ctx.storage.brpop(keys, timeout);
  if (result === null) return encodeArray(null);
  return encodeArray([result.key, result.element]);
}

async function handleBrpoplpush(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'BRPOPLPUSH' command");
  }
  const timeout = parseFloat(args[2]);
  if (isNaN(timeout)) {
    return encodeError('ERR timeout is not a float or out of range');
  }
  const result = await ctx.storage.brpoplpush(args[0], args[1], timeout);
  return encodeBulkString(result);
}

async function handleBlmove(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 5) {
    return encodeError("wrong number of arguments for 'BLMOVE' command");
  }
  const srcDir = args[2].toUpperCase();
  const destDir = args[3].toUpperCase();
  if ((srcDir !== 'LEFT' && srcDir !== 'RIGHT') || (destDir !== 'LEFT' && destDir !== 'RIGHT')) {
    return encodeError('ERR syntax error');
  }
  const timeout = parseFloat(args[4]);
  if (isNaN(timeout)) {
    return encodeError('ERR timeout is not a float or out of range');
  }
  const result = await ctx.storage.blmove(args[0], args[1], srcDir as 'LEFT' | 'RIGHT', destDir as 'LEFT' | 'RIGHT', timeout);
  return encodeBulkString(result);
}

async function handleLmpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'LMPOP' command");
  }
  const numkeys = parseInt(args[0]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 1 + numkeys + 1) {
    return encodeError("wrong number of arguments for 'LMPOP' command");
  }
  const keys = args.slice(1, 1 + numkeys);
  let dir: 'LEFT' | 'RIGHT' | undefined;
  let count: number | undefined;

  for (let i = 1 + numkeys; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'LEFT' || opt === 'RIGHT') {
      dir = opt as 'LEFT' | 'RIGHT';
    } else if (opt === 'COUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count) || count <= 0) return encodeError('ERR value is not an integer or out of range');
    } else {
      return encodeError('ERR syntax error');
    }
  }

  if (!dir) {
    return encodeError('ERR syntax error');
  }

  const result = await ctx.storage.lmpop(numkeys, keys, dir, count);
  if (result === null) return encodeArray(null);
  const keyEncoded = encodeBulkString(result.key);
  const elementsEncoded = encodeArray(result.elements);
  return `*2\r\n${keyEncoded}${elementsEncoded}`;
}