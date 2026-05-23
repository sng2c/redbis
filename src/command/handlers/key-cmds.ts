import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerKeyCommands(registry: Map<string, CommandFn>): void {
  registry.set('RENAME', handleRename);
  registry.set('RENAMENX', handleRenamenx);
  registry.set('TYPE', handleType);
  registry.set('DBSIZE', handleDbsize);
  registry.set('COPY', handleCopy);
  registry.set('RANDOMKEY', handleRandomkey);
  registry.set('UNLINK', handleUnlink);
  registry.set('TOUCH', handleTouch);
  registry.set('SCAN', handleScan);
  registry.set('EXPIRE', handleExpire);
  registry.set('EXPIREAT', handleExpireat);
  registry.set('PEXPIRE', handlePexpire);
  registry.set('PEXPIREAT', handlePexpireat);
  registry.set('TTL', handleTtl);
  registry.set('PTTL', handlePttl);
  registry.set('PERSIST', handlePersist);
  registry.set('EXPIRETIME', handleExpiretime);
  registry.set('PEXPIRETIME', handlePexpiretime);
}

// === Key management ===

async function handleRename(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'RENAME' command");
  }
  try {
    await ctx.storage.rename(args[0], args[1]);
    return encodeSimpleString('OK');
  } catch (e: any) {
    return encodeError(e.message);
  }
}

async function handleRenamenx(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'RENAMENX' command");
  }
  try {
    const result = await ctx.storage.renamenx(args[0], args[1]);
    return encodeInteger(result ? 1 : 0);
  } catch (e: any) {
    return encodeError(e.message);
  }
}

async function handleType(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'TYPE' command");
  }
  const result = await ctx.storage.type(args[0]);
  return encodeSimpleString(result);
}

async function handleDbsize(ctx: HandlerContext, args: string[]): Promise<string> {
  const result = await ctx.storage.dbsize();
  return encodeInteger(result);
}

async function handleCopy(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'COPY' command");
  }
  const result = await ctx.storage.copy(args[0], args[1]);
  return encodeInteger(result ? 1 : 0);
}

async function handleRandomkey(ctx: HandlerContext, args: string[]): Promise<string> {
  const result = await ctx.storage.randomkey();
  return encodeBulkString(result);
}

async function handleUnlink(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length === 0) {
    return encodeError("wrong number of arguments for 'UNLINK' command");
  }
  const result = await ctx.storage.unlink(args);
  return encodeInteger(result);
}

async function handleTouch(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length === 0) {
    return encodeError("wrong number of arguments for 'TOUCH' command");
  }
  const result = await ctx.storage.touch(args);
  return encodeInteger(result);
}

async function handleScan(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'SCAN' command");
  }
  const cursor = parseInt(args[0]);
  if (isNaN(cursor)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  let pattern: string | undefined;
  let count: number | undefined;
  for (let i = 1; i < args.length; i++) {
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
  const result = await ctx.storage.scan(cursor, pattern, count);
  const cursorStr = encodeBulkString(String(result.cursor));
  const keysArr = encodeArray(result.keys);
  return `*2\r\n${cursorStr}${keysArr}`;
}

// === Expiry ===

async function handleExpire(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'EXPIRE' command");
  }
  const seconds = parseInt(args[1]);
  if (isNaN(seconds)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.expire(args[0], seconds);
  return encodeInteger(result ? 1 : 0);
}

async function handleExpireat(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'EXPIREAT' command");
  }
  const timestamp = parseInt(args[1]);
  if (isNaN(timestamp)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.expireat(args[0], timestamp);
  return encodeInteger(result ? 1 : 0);
}

async function handlePexpire(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'PEXPIRE' command");
  }
  const ms = parseInt(args[1]);
  if (isNaN(ms)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.pexpire(args[0], ms);
  return encodeInteger(result ? 1 : 0);
}

async function handlePexpireat(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'PEXPIREAT' command");
  }
  const msTimestamp = parseInt(args[1]);
  if (isNaN(msTimestamp)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.pexpireat(args[0], msTimestamp);
  return encodeInteger(result ? 1 : 0);
}

async function handleTtl(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'TTL' command");
  }
  const result = await ctx.storage.ttl(args[0]);
  return encodeInteger(result);
}

async function handlePttl(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'PTTL' command");
  }
  const result = await ctx.storage.pttl(args[0]);
  return encodeInteger(result);
}

async function handlePersist(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'PERSIST' command");
  }
  const result = await ctx.storage.persist(args[0]);
  return encodeInteger(result ? 1 : 0);
}

async function handleExpiretime(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'EXPIRETIME' command");
  }
  const result = await ctx.storage.expiretime(args[0]);
  return encodeInteger(result);
}

async function handlePexpiretime(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'PEXPIRETIME' command");
  }
  const result = await ctx.storage.pexpiretime(args[0]);
  return encodeInteger(result);
}
