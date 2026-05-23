import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeBulkString, encodeArray } from '../../protocol/resp';

export function encodeStreamEntry(entry: { id: string; fields: Record<string, string> }): string {
  const flat: string[] = [entry.id];
  for (const [k, v] of Object.entries(entry.fields)) {
    flat.push(k, v);
  }
  return encodeArray(flat);
}

export function registerStreamBasicCommands(registry: Map<string, CommandFn>): void {
  registry.set('XADD', handleXadd);
  registry.set('XTRIM', handleXtrim);
  registry.set('XDEL', handleXdel);
  registry.set('XRANGE', handleXrange);
  registry.set('XREVRANGE', handleXrevrange);
  registry.set('XLEN', handleXlen);
  registry.set('XREAD', handleXread);
}

async function handleXadd(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'XADD' command");
  }
  const key = args[0];
  let nomkstream = false;
  let maxlen: number | undefined;
  let approx = false;
  let minid: string | undefined;
  let limit: number | undefined;
  let i = 1;

  // Parse optional flags
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    if (opt === 'NOMKSTREAM') {
      nomkstream = true;
      i++;
    } else if (opt === 'MAXLEN') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      approx = false;
      if (args[i] === '~') {
        approx = true;
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
      }
      maxlen = parseInt(args[i]);
      if (isNaN(maxlen) || maxlen < 0)
        return encodeError('ERR value is not an integer or out of range');
      i++;
      // Check for LIMIT after MAXLEN
      if (i < args.length && args[i].toUpperCase() === 'LIMIT') {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        limit = parseInt(args[i]);
        if (isNaN(limit)) return encodeError('ERR value is not an integer or out of range');
        i++;
      }
    } else if (opt === 'MINID') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      approx = false;
      if (args[i] === '~') {
        approx = true;
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
      }
      minid = args[i];
      i++;
      if (i < args.length && args[i].toUpperCase() === 'LIMIT') {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        limit = parseInt(args[i]);
        if (isNaN(limit)) return encodeError('ERR value is not an integer or out of range');
        i++;
      }
    } else {
      break;
    }
  }

  // Next arg is the ID
  if (i >= args.length) return encodeError("wrong number of arguments for 'XADD' command");
  let id = args[i];
  i++;

  // Remaining args must be field-value pairs
  const remaining = args.length - i;
  if (remaining < 2 || remaining % 2 !== 0) {
    return encodeError("wrong number of arguments for 'XADD' command");
  }
  const fields: Record<string, string> = {};
  for (let j = i; j < args.length; j += 2) {
    fields[args[j]] = args[j + 1];
  }

  const options: {
    maxlen?: number;
    approx?: boolean;
    minid?: string;
    nomkstream?: boolean;
    limit?: number;
  } = {};
  if (maxlen !== undefined) {
    options.maxlen = maxlen;
    options.approx = approx;
  }
  if (minid !== undefined) {
    options.minid = minid;
    options.approx = approx;
  }
  if (nomkstream) options.nomkstream = true;
  if (limit !== undefined) options.limit = limit;

  const result = await ctx.storage.xadd(key, id, fields, options);
  if (result === null) return encodeBulkString(null);
  return encodeBulkString(result);
}

async function handleXtrim(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'XTRIM' command");
  }
  const key = args[0];
  const strategyArg = args[1].toUpperCase();
  let strategy: 'MAXLEN' | 'MINID';
  if (strategyArg === 'MAXLEN') {
    strategy = 'MAXLEN';
  } else if (strategyArg === 'MINID') {
    strategy = 'MINID';
  } else {
    return encodeError('ERR syntax error');
  }
  let approx = false;
  let threshold: string | number;
  let limit: number | undefined;
  let i = 2;
  if (args[i] === '~') {
    approx = true;
    i++;
  }
  threshold = strategy === 'MAXLEN' ? parseInt(args[i]) : args[i];
  if (strategy === 'MAXLEN' && isNaN(threshold as number)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  i++;
  if (i < args.length && args[i].toUpperCase() === 'LIMIT') {
    i++;
    if (i >= args.length) return encodeError('ERR syntax error');
    limit = parseInt(args[i]);
    if (isNaN(limit)) return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.xtrim(key, strategy, threshold, approx, limit);
  return encodeInteger(result);
}

async function handleXdel(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'XDEL' command");
  }
  const key = args[0];
  const ids = args.slice(1);
  const result = await ctx.storage.xdel(key, ids);
  return encodeInteger(result);
}

async function handleXrange(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'XRANGE' command");
  }
  const key = args[0];
  const start = args[1];
  const end = args[2];
  let count: number | undefined;
  for (let i = 3; i < args.length; i++) {
    if (args[i].toUpperCase() === 'COUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const result = await ctx.storage.xrange(key, start, end, count);
  const parts = result.map((e) => encodeStreamEntry(e));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleXrevrange(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'XREVRANGE' command");
  }
  const key = args[0];
  const end = args[1]; // Note: XREVRANGE args are end then start
  const start = args[2];
  let count: number | undefined;
  for (let i = 3; i < args.length; i++) {
    if (args[i].toUpperCase() === 'COUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const result = await ctx.storage.xrevrange(key, end, start, count);
  const parts = result.map((e) => encodeStreamEntry(e));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleXlen(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'XLEN' command");
  }
  const result = await ctx.storage.xlen(args[0]);
  return encodeInteger(result);
}

async function handleXread(ctx: HandlerContext, args: string[]): Promise<string> {
  let count: number | undefined;
  let block: number | undefined;
  let i = 0;
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    if (opt === 'COUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      i++;
    } else if (opt === 'BLOCK') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      block = parseInt(args[i]);
      if (isNaN(block)) return encodeError('ERR value is not an integer or out of range');
      i++;
    } else if (opt === 'STREAMS') {
      i++;
      break;
    } else {
      return encodeError('ERR syntax error');
    }
  }
  if (i >= args.length) return encodeError("wrong number of arguments for 'XREAD' command");
  // After STREAMS: keys then IDs, each count is the same
  const remaining = args.length - i;
  if (remaining < 2 || remaining % 2 !== 0) {
    return encodeError("wrong number of arguments for 'XREAD' command");
  }
  const numStreams = remaining / 2;
  const keys = args.slice(i, i + numStreams);
  const ids = args.slice(i + numStreams);

  const result = await ctx.storage.xread(keys, ids, count);
  if (result === null) return encodeArray(null);
  // Format: array of [key, [entries...]]
  const parts = result.map((stream) => {
    const keyEnc = encodeBulkString(stream.key);
    const entriesEnc = `*${stream.entries.length}\r\n${stream.entries.map((e) => encodeStreamEntry(e)).join('')}`;
    return `*2\r\n${keyEnc}${entriesEnc}`;
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}