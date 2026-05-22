import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerHashCommands(registry: Map<string, CommandFn>): void {
  registry.set('HSET', handleHset);
  registry.set('HGET', handleHget);
  registry.set('HDEL', handleHdel);
  registry.set('HGETALL', handleHgetall);
  registry.set('HKEYS', handleHkeys);
  registry.set('HVALS', handleHvals);
  registry.set('HLEN', handleHlen);
  registry.set('HEXISTS', handleHexists);
  registry.set('HSETNX', handleHsetnx);
  registry.set('HMSET', handleHmset);
  registry.set('HMGET', handleHmget);
  registry.set('HINCRBY', handleHincrby);
  registry.set('HINCRBYFLOAT', handleHincrbyfloat);
  registry.set('HRANDFIELD', handleHrandfield);
  registry.set('HSCAN', handleHscan);
  registry.set('HSTRLEN', handleHstrlen);
  registry.set('HGETDEL', handleHgetdel);
  registry.set('HGETEX', handleHgetex);
  registry.set('HSETEX', handleHsetex);
  registry.set('HEXPIRE', handleHexpire);
  registry.set('HEXPIREAT', handleHexpireat);
  registry.set('HPEXPIRE', handleHpexpire);
  registry.set('HPEXPIREAT', handleHpexpireat);
  registry.set('HEXPIRETIME', handleHexpiretime);
  registry.set('HPEXPIRETIME', handleHpexpiretime);
  registry.set('HPERSIST', handleHpersist);
  registry.set('HTTL', handleHttl);
  registry.set('HPTTL', handleHpttl);
}

// === Hash operations ===

async function handleHset(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3 || (args.length - 1) % 2 !== 0) {
    return encodeError("wrong number of arguments for 'HSET' command");
  }
  const key = args[0];
  const pairs: Array<{ field: string; value: string }> = [];
  for (let i = 1; i < args.length; i += 2) {
    pairs.push({ field: args[i], value: args[i + 1] });
  }
  const result = await ctx.storage.hset(key, pairs);
  return encodeInteger(result);
}

async function handleHget(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'HGET' command");
  }
  const result = await ctx.storage.hget(args[0], args[1]);
  return encodeBulkString(result);
}

async function handleHdel(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HDEL' command");
  }
  const key = args[0];
  const fields = args.slice(1);
  const result = await ctx.storage.hdel(key, fields);
  return encodeInteger(result);
}

async function handleHgetall(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'HGETALL' command");
  }
  const result = await ctx.storage.hgetall(args[0]);
  const items: string[] = [];
  for (const { field, value } of result) {
    items.push(field, value);
  }
  return encodeArray(items);
}

async function handleHkeys(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'HKEYS' command");
  }
  const result = await ctx.storage.hkeys(args[0]);
  return encodeArray(result);
}

async function handleHvals(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'HVALS' command");
  }
  const result = await ctx.storage.hvals(args[0]);
  return encodeArray(result);
}

async function handleHlen(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'HLEN' command");
  }
  const result = await ctx.storage.hlen(args[0]);
  return encodeInteger(result);
}

async function handleHexists(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'HEXISTS' command");
  }
  const result = await ctx.storage.hexists(args[0], args[1]);
  return encodeInteger(result ? 1 : 0);
}

async function handleHsetnx(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'HSETNX' command");
  }
  const result = await ctx.storage.hsetnx(args[0], args[1], args[2]);
  return encodeInteger(result ? 1 : 0);
}

async function handleHmset(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3 || (args.length - 1) % 2 !== 0) {
    return encodeError("wrong number of arguments for 'HMSET' command");
  }
  const key = args[0];
  const pairs: Array<{ field: string; value: string }> = [];
  for (let i = 1; i < args.length; i += 2) {
    pairs.push({ field: args[i], value: args[i + 1] });
  }
  await ctx.storage.hset(key, pairs);
  return encodeSimpleString('OK');
}

async function handleHmget(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HMGET' command");
  }
  const key = args[0];
  const fields = args.slice(1);
  const result = await ctx.storage.hmget(key, fields);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleHincrby(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'HINCRBY' command");
  }
  const delta = parseInt(args[2]);
  if (isNaN(delta)) {
    return encodeError('value is not an integer or out of range');
  }
  const result = await ctx.storage.hincrby(args[0], args[1], delta);
  return encodeInteger(result);
}

async function handleHincrbyfloat(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'HINCRBYFLOAT' command");
  }
  const delta = parseFloat(args[2]);
  if (isNaN(delta)) {
    return encodeError('value is not a valid float');
  }
  const result = await ctx.storage.hincrbyfloat(args[0], args[1], delta);
  return encodeBulkString(result);
}

async function handleHrandfield(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1 || args.length > 3) {
    return encodeError("wrong number of arguments for 'HRANDFIELD' command");
  }
  const key = args[0];
  let count: number | undefined;
  let withValues = false;

  if (args.length >= 2) {
    count = parseInt(args[1]);
    if (isNaN(count)) {
      return encodeError('value is not an integer or out of range');
    }
  }
  if (args.length >= 3) {
    if (args[2].toUpperCase() !== 'WITHVALUES') {
      return encodeError('ERR syntax error');
    }
    withValues = true;
  }

  if (count === undefined) {
    const fields = await ctx.storage.hrandfield(key, 1);
    if (fields.length === 0) return encodeBulkString(null);
    return encodeBulkString(fields[0]);
  }

  const fields = await ctx.storage.hrandfield(key, count);

  if (!withValues) {
    return encodeArray(fields);
  }

  const values = await ctx.storage.hmget(key, fields);
  const items: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    items.push(fields[i], values[i] ?? '');
  }
  return encodeArray(items);
}

async function handleHscan(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HSCAN' command");
  }
  const key = args[0];
  const cursor = parseInt(args[1]);
  if (isNaN(cursor)) {
    return encodeError('value is not an integer or out of range');
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
      if (isNaN(count)) return encodeError('value is not an integer or out of range');
    } else {
      return encodeError('ERR syntax error');
    }
  }
  const result = await ctx.storage.hscan(cursor, key, pattern, count);
  const cursorStr = encodeBulkString(String(result.cursor));
  const items: string[] = [];
  for (const { field, value } of result.items) {
    items.push(field, value);
  }
  const itemsArr = encodeArray(items);
  return `*2\r\n${cursorStr}${itemsArr}`;
}

async function handleHstrlen(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'HSTRLEN' command");
  }
  const result = await ctx.storage.hstrlen(args[0], args[1]);
  return encodeInteger(result);
}

async function handleHgetdel(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HGETDEL' command");
  }
  const key = args[0];
  const fields = args.slice(1);
  const result = await ctx.storage.hgetdel(key, fields);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleHgetex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HGETEX' command");
  }
  const key = args[0];
  const fields: string[] = [];
  const options: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean } = {};
  let parsingFields = true;

  for (let i = 1; i < args.length; i++) {
    const upper = args[i].toUpperCase();
    if (parsingFields && (upper === 'EX' || upper === 'PX' || upper === 'EXAT' || upper === 'PXAT' || upper === 'PERSIST')) {
      parsingFields = false;
    }
    if (parsingFields) {
      fields.push(args[i]);
      continue;
    }
    switch (upper) {
      case 'EX': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        options.ex = parseInt(args[i]);
        if (isNaN(options.ex)) return encodeError('value is not an integer or out of range');
        break;
      }
      case 'PX': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        options.px = parseInt(args[i]);
        if (isNaN(options.px)) return encodeError('value is not an integer or out of range');
        break;
      }
      case 'EXAT': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        options.exat = parseInt(args[i]);
        if (isNaN(options.exat)) return encodeError('value is not an integer or out of range');
        break;
      }
      case 'PXAT': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        options.pxat = parseInt(args[i]);
        if (isNaN(options.pxat)) return encodeError('value is not an integer or out of range');
        break;
      }
      case 'PERSIST': {
        options.persist = true;
        break;
      }
      default:
        return encodeError('ERR syntax error');
    }
  }

  if (fields.length === 0) {
    return encodeError("wrong number of arguments for 'HGETEX' command");
  }

  const hasOpts = options.ex !== undefined || options.px !== undefined ||
                  options.exat !== undefined || options.pxat !== undefined ||
                  options.persist !== undefined;
  const result = await ctx.storage.hgetex(key, fields, hasOpts ? options : undefined);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleHsetex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'HSETEX' command");
  }
  const key = args[0];
  const options: { ex?: number; px?: number; exat?: number; pxat?: number; keepttl?: boolean } = {};
  const pairs: Array<{ field: string; value: string }> = [];
  let i = 1;

  while (i < args.length) {
    const opt = args[i].toUpperCase();
    let consumed = false;
    switch (opt) {
      case 'EX': {
        if (i + 1 >= args.length) return encodeError('ERR syntax error');
        const val = parseInt(args[i + 1]);
        if (isNaN(val)) return encodeError('value is not an integer or out of range');
        options.ex = val;
        i += 2;
        consumed = true;
        break;
      }
      case 'PX': {
        if (i + 1 >= args.length) return encodeError('ERR syntax error');
        const val = parseInt(args[i + 1]);
        if (isNaN(val)) return encodeError('value is not an integer or out of range');
        options.px = val;
        i += 2;
        consumed = true;
        break;
      }
      case 'EXAT': {
        if (i + 1 >= args.length) return encodeError('ERR syntax error');
        const val = parseInt(args[i + 1]);
        if (isNaN(val)) return encodeError('value is not an integer or out of range');
        options.exat = val;
        i += 2;
        consumed = true;
        break;
      }
      case 'PXAT': {
        if (i + 1 >= args.length) return encodeError('ERR syntax error');
        const val = parseInt(args[i + 1]);
        if (isNaN(val)) return encodeError('value is not an integer or out of range');
        options.pxat = val;
        i += 2;
        consumed = true;
        break;
      }
      case 'KEEPTTL': {
        options.keepttl = true;
        i++;
        consumed = true;
        break;
      }
    }
    if (!consumed) break;
  }

  const remaining = args.length - i;
  if (remaining < 2 || remaining % 2 !== 0) {
    return encodeError("wrong number of arguments for 'HSETEX' command");
  }
  for (let j = i; j < args.length; j += 2) {
    pairs.push({ field: args[j], value: args[j + 1] });
  }

  const hasOptions = options.ex !== undefined || options.px !== undefined ||
                     options.exat !== undefined || options.pxat !== undefined ||
                     options.keepttl !== undefined;
  const result = await ctx.storage.hsetex(key, pairs, hasOptions ? options : undefined);
  return encodeInteger(result);
}

async function handleHexpire(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'HEXPIRE' command");
  }
  const key = args[0];
  const seconds = parseInt(args[1]);
  if (isNaN(seconds)) {
    return encodeError('value is not an integer or out of range');
  }
  if (args[2].toUpperCase() !== 'FIELDS') {
    return encodeError('ERR syntax error');
  }
  const fields = args.slice(3);
  if (fields.length === 0) {
    return encodeError("wrong number of arguments for 'HEXPIRE' command");
  }
  const result = await ctx.storage.hexpire(key, fields, seconds);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}

async function handleHexpireat(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'HEXPIREAT' command");
  }
  const key = args[0];
  const timestamp = parseInt(args[1]);
  if (isNaN(timestamp)) {
    return encodeError('value is not an integer or out of range');
  }
  if (args[2].toUpperCase() !== 'FIELDS') {
    return encodeError('ERR syntax error');
  }
  const fields = args.slice(3);
  if (fields.length === 0) {
    return encodeError("wrong number of arguments for 'HEXPIREAT' command");
  }
  const result = await ctx.storage.hexpireat(key, fields, timestamp);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}

async function handleHpexpire(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'HPEXPIRE' command");
  }
  const key = args[0];
  const milliseconds = parseInt(args[1]);
  if (isNaN(milliseconds)) {
    return encodeError('value is not an integer or out of range');
  }
  if (args[2].toUpperCase() !== 'FIELDS') {
    return encodeError('ERR syntax error');
  }
  const fields = args.slice(3);
  if (fields.length === 0) {
    return encodeError("wrong number of arguments for 'HPEXPIRE' command");
  }
  const result = await ctx.storage.hpexpire(key, fields, milliseconds);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}

async function handleHpexpireat(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'HPEXPIREAT' command");
  }
  const key = args[0];
  const msTimestamp = parseInt(args[1]);
  if (isNaN(msTimestamp)) {
    return encodeError('value is not an integer or out of range');
  }
  if (args[2].toUpperCase() !== 'FIELDS') {
    return encodeError('ERR syntax error');
  }
  const fields = args.slice(3);
  if (fields.length === 0) {
    return encodeError("wrong number of arguments for 'HPEXPIREAT' command");
  }
  const result = await ctx.storage.hpexpireat(key, fields, msTimestamp);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}

async function handleHexpiretime(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HEXPIRETIME' command");
  }
  const key = args[0];
  const fields = args.slice(1);
  const result = await ctx.storage.hexpiretime(key, fields);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}

async function handleHpexpiretime(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HPEXPIRETIME' command");
  }
  const key = args[0];
  const fields = args.slice(1);
  const result = await ctx.storage.hpexpiretime(key, fields);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}

async function handleHpersist(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HPERSIST' command");
  }
  const key = args[0];
  const fields = args.slice(1);
  const result = await ctx.storage.hpersist(key, fields);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}

async function handleHttl(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HTTL' command");
  }
  const key = args[0];
  const fields = args.slice(1);
  const result = await ctx.storage.httl(key, fields);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}

async function handleHpttl(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'HPTTL' command");
  }
  const key = args[0];
  const fields = args.slice(1);
  const result = await ctx.storage.hpttl(key, fields);
  return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
}