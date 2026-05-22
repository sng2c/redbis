import { HandlerContext, CommandFn } from '../context';
import {
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerSetCommands(registry: Map<string, CommandFn>): void {
  registry.set('SADD', handleSadd);
  registry.set('SREM', handleSrem);
  registry.set('SMEMBERS', handleSmembers);
  registry.set('SCARD', handleScard);
  registry.set('SISMEMBER', handleSismember);
  registry.set('SMISMEMBER', handleSmismember);
  registry.set('SRANDMEMBER', handleSrandmember);
  registry.set('SPOP', handleSpop);
  registry.set('SMOVE', handleSmove);
  registry.set('SDIFF', handleSdiff);
  registry.set('SINTER', handleSinter);
  registry.set('SUNION', handleSunion);
  registry.set('SDIFFSTORE', handleSdiffstore);
  registry.set('SINTERSTORE', handleSinterstore);
  registry.set('SUNIONSTORE', handleSunionstore);
  registry.set('SINTERCARD', handleSintercard);
  registry.set('SSCAN', handleSscan);
}

async function handleSadd(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'sadd' command");
  }
  const key = args[0];
  const members = args.slice(1);
  const result = await ctx.storage.sadd(key, members);
  return encodeInteger(result);
}

async function handleSrem(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'srem' command");
  }
  const key = args[0];
  const members = args.slice(1);
  const result = await ctx.storage.srem(key, members);
  return encodeInteger(result);
}

async function handleSmembers(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'smembers' command");
  }
  const key = args[0];
  const result = await ctx.storage.smembers(key);
  return encodeArray(result);
}

async function handleScard(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'scard' command");
  }
  const key = args[0];
  const result = await ctx.storage.scard(key);
  return encodeInteger(result);
}

async function handleSismember(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'sismember' command");
  }
  const key = args[0];
  const member = args[1];
  const result = await ctx.storage.sismember(key, member);
  return encodeInteger(result ? 1 : 0);
}

async function handleSmismember(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'smismember' command");
  }
  const key = args[0];
  const members = args.slice(1);
  const results = await ctx.storage.smismember(key, members);
  const parts = results.map(r => encodeInteger(r ? 1 : 0));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleSrandmember(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'srandmember' command");
  }
  const key = args[0];
  if (args.length >= 2) {
    const count = parseInt(args[1]);
    if (isNaN(count)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const results = await ctx.storage.srandmember(key, count);
    return encodeArray(results);
  }
  const results = await ctx.storage.srandmember(key);
  return encodeBulkString(results[0] ?? null);
}

async function handleSpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'spop' command");
  }
  const key = args[0];
  if (args.length >= 2) {
    const count = parseInt(args[1]);
    if (isNaN(count)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const results = await ctx.storage.spop(key, count);
    if (count === 1) {
      return encodeBulkString(results[0] ?? null);
    }
    return encodeArray(results);
  }
  const results = await ctx.storage.spop(key);
  if (results.length === 0) return encodeBulkString(null);
  return encodeBulkString(results[0]);
}

async function handleSmove(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'smove' command");
  }
  const source = args[0];
  const destination = args[1];
  const member = args[2];
  const result = await ctx.storage.smove(source, destination, member);
  return encodeInteger(result ? 1 : 0);
}

async function handleSdiff(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'sdiff' command");
  }
  const keys = args;
  const result = await ctx.storage.sdiff(keys);
  return encodeArray(result);
}

async function handleSinter(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'sinter' command");
  }
  const keys = args;
  const result = await ctx.storage.sinter(keys);
  return encodeArray(result);
}

async function handleSunion(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'sunion' command");
  }
  const keys = args;
  const result = await ctx.storage.sunion(keys);
  return encodeArray(result);
}

async function handleSdiffstore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'sdiffstore' command");
  }
  const destination = args[0];
  const keys = args.slice(1);
  const result = await ctx.storage.sdiffstore(destination, keys);
  return encodeInteger(result);
}

async function handleSinterstore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'sinterstore' command");
  }
  const destination = args[0];
  const keys = args.slice(1);
  const result = await ctx.storage.sinterstore(destination, keys);
  return encodeInteger(result);
}

async function handleSunionstore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'sunionstore' command");
  }
  const destination = args[0];
  const keys = args.slice(1);
  const result = await ctx.storage.sunionstore(destination, keys);
  return encodeInteger(result);
}

async function handleSintercard(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'sintercard' command");
  }
  const numkeys = parseInt(args[0]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 1 + numkeys) {
    return encodeError("wrong number of arguments for 'sintercard' command");
  }
  const keys = args.slice(1, 1 + numkeys);
  let limit: number | undefined;
  const remaining = args.slice(1 + numkeys);
  for (let i = 0; i < remaining.length; i++) {
    const opt = remaining[i].toUpperCase();
    if (opt === 'LIMIT') {
      i++;
      if (i >= remaining.length) return encodeError('ERR syntax error');
      limit = parseInt(remaining[i]);
      if (isNaN(limit)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const result = await ctx.storage.sintercard(keys, limit);
  return encodeInteger(result);
}

async function handleSscan(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'sscan' command");
  }
  const key = args[0];
  const cursor = parseInt(args[1]);
  if (isNaN(cursor)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  let pattern: string | undefined;
  let count: number | undefined;
  for (let i = 2; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'MATCH') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      pattern = args[i];
    } else if (opt === 'COUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const result = await ctx.storage.sscan(key, cursor, pattern, count);
  const cursorStr = encodeBulkString(String(result[0]));
  const membersArr = encodeArray(result[1]);
  return `*2\r\n${cursorStr}${membersArr}`;
}