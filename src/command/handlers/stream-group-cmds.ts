import { HandlerContext, CommandFn } from '../context';
import { encodeSimpleString, encodeError, encodeInteger, encodeBulkString, encodeArray } from '../../protocol/resp';
import type { StreamEntry, PendingEntry } from '../../storage/interface';
import { encodeStreamEntry } from './stream-basic-cmds';

export function registerStreamGroupCommands(registry: Map<string, CommandFn>): void {
  registry.set('XGROUP', handleXgroup);
  registry.set('XREADGROUP', handleXreadgroup);
  registry.set('XACK', handleXack);
  registry.set('XPENDING', handleXpending);
  registry.set('XCLAIM', handleXclaim);
  registry.set('XAUTOCLAIM', handleXautoclaim);
  registry.set('XINFO', handleXinfo);
  registry.set('XSETID', handleXsetid);
}

async function handleXgroup(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'XGROUP' command");
  const sub = args[0].toUpperCase();
  switch (sub) {
    case 'CREATE':
      return await handleXgroupCreate(ctx, args.slice(1));
    case 'DESTROY':
      return await handleXgroupDestroy(ctx, args.slice(1));
    case 'CREATECONSUMER':
      return await handleXgroupCreateconsumer(ctx, args.slice(1));
    case 'DELCONSUMER':
      return await handleXgroupDelconsumer(ctx, args.slice(1));
    case 'SETID':
      return await handleXgroupSetid(ctx, args.slice(1));
    default:
      return encodeError(`unknown subcommand '${args[0]}'`);
  }
}

async function handleXgroupCreate(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'XGROUP CREATE' command");
  const key = args[0];
  const group = args[1];
  let id = args[2];
  let mkstream = false;
  for (let i = 3; i < args.length; i++) {
    if (args[i].toUpperCase() === 'MKSTREAM') {
      mkstream = true;
    }
  }
  const result = await ctx.storage.xgroupCreate(key, group, id, mkstream);
  return encodeSimpleString(result);
}

async function handleXgroupDestroy(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'XGROUP DESTROY' command");
  const key = args[0];
  const group = args[1];
  const result = await ctx.storage.xgroupDestroy(key, group);
  return encodeInteger(result);
}

async function handleXgroupCreateconsumer(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3)
    return encodeError("wrong number of arguments for 'XGROUP CREATECONSUMER' command");
  const key = args[0];
  const group = args[1];
  const consumer = args[2];
  const result = await ctx.storage.xgroupCreateconsumer(key, group, consumer);
  return encodeInteger(result);
}

async function handleXgroupDelconsumer(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3)
    return encodeError("wrong number of arguments for 'XGROUP DELCONSUMER' command");
  const key = args[0];
  const group = args[1];
  const consumer = args[2];
  const result = await ctx.storage.xgroupDelconsumer(key, group, consumer);
  return encodeInteger(result);
}

async function handleXgroupSetid(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'XGROUP SETID' command");
  const key = args[0];
  const group = args[1];
  const id = args[2];
  const result = await ctx.storage.xgroupSetid(key, group, id);
  return encodeSimpleString(result);
}

async function handleXreadgroup(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 4) return encodeError("wrong number of arguments for 'XREADGROUP' command");
  // GROUP group consumer [COUNT count] [BLOCK ms] STREAMS key [key ...] ID [ID ...]
  if (args[0].toUpperCase() !== 'GROUP') return encodeError('ERR syntax error');
  const group = args[1];
  const consumer = args[2];
  let count: number | undefined;
  let block: number | undefined;
  let noack = false;
  let i = 3;
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
    } else if (opt === 'NOACK') {
      noack = true;
      i++;
    } else if (opt === 'STREAMS') {
      i++;
      break;
    } else {
      return encodeError('ERR syntax error');
    }
  }
  if (i >= args.length) return encodeError("wrong number of arguments for 'XREADGROUP' command");
  const remaining = args.length - i;
  if (remaining < 2 || remaining % 2 !== 0) {
    return encodeError("wrong number of arguments for 'XREADGROUP' command");
  }
  const numStreams = remaining / 2;
  const keys = args.slice(i, i + numStreams);
  const ids = args.slice(i + numStreams);

  const result = await ctx.storage.xreadgroup(group, consumer, keys, ids, count, noack);
  if (result === null) return encodeArray(null);
  const parts = result.map((stream) => {
    const keyEnc = encodeBulkString(stream.key);
    const entriesEnc = `*${stream.entries.length}\r\n${stream.entries.map((e) => encodeStreamEntry(e)).join('')}`;
    return `*2\r\n${keyEnc}${entriesEnc}`;
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleXack(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'XACK' command");
  const key = args[0];
  const group = args[1];
  const ids = args.slice(2);
  const result = await ctx.storage.xack(key, group, ids);
  return encodeInteger(result);
}

async function handleXpending(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'XPENDING' command");
  const key = args[0];
  const group = args[1];

  // Two forms:
  // XPENDING key group [[IDLE min-idle] start end count [consumer]]
  if (args.length === 2) {
    // Summary form
    const result = await ctx.storage.xpending(key, group);
    if (Array.isArray(result)) {
      // Detailed form result (shouldn't happen here but handle)
      const entries = result as PendingEntry[];
      const parts = entries.map((e) => {
        return `*4\r\n${encodeBulkString(e.id)}${encodeBulkString(e.consumer)}${encodeInteger(Math.floor(e.deliveredTime))}${encodeInteger(e.deliveryCount)}`;
      });
      return `*${parts.length}\r\n${parts.join('')}`;
    }
    // Summary: { count, minId, maxId, consumers }
    const summary = result as {
      count: number;
      minId: string | null;
      maxId: string | null;
      consumers: Array<{ name: string; pending: number }>;
    };
    const consumerParts = summary.consumers.map((c) => {
      return `*2\r\n${encodeBulkString(c.name)}${encodeInteger(c.pending)}`;
    });
    return `*${4 + consumerParts.length}\r\n${encodeInteger(summary.count)}${encodeBulkString(summary.minId)}${encodeBulkString(summary.maxId)}${encodeInteger(consumerParts.length)}${consumerParts.join('')}`;
  }

  // Detailed form
  let i = 2;
  let idle: number | undefined;
  if (args[i].toUpperCase() === 'IDLE') {
    i++;
    if (i >= args.length) return encodeError('ERR syntax error');
    idle = parseInt(args[i]);
    if (isNaN(idle)) return encodeError('ERR value is not an integer or out of range');
    i++;
  }
  if (i + 2 >= args.length) return encodeError("wrong number of arguments for 'XPENDING' command");
  const start = args[i];
  const end = args[i + 1];
  const count = parseInt(args[i + 2]);
  if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
  let consumer: string | undefined;
  if (i + 3 < args.length) {
    consumer = args[i + 3];
  }
  const options: {
    start?: string;
    end?: string;
    count?: number;
    consumer?: string;
    idle?: number;
  } = {};
  options.start = start;
  options.end = end;
  options.count = count;
  if (consumer) options.consumer = consumer;
  if (idle !== undefined) options.idle = idle;
  const result = await ctx.storage.xpending(key, group, options);
  // Detailed form returns PendingEntry[]
  if (Array.isArray(result)) {
    const entries = result as PendingEntry[];
    const parts = entries.map((e) => {
      return `*4\r\n${encodeBulkString(e.id)}${encodeBulkString(e.consumer)}${encodeInteger(Math.floor(e.deliveredTime))}${encodeInteger(e.deliveryCount)}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }
  // Summary (shouldn't reach here usually)
  const summary = result as {
    count: number;
    minId: string | null;
    maxId: string | null;
    consumers: Array<{ name: string; pending: number }>;
  };
  const consumerParts = summary.consumers.map((c) => {
    return `*2\r\n${encodeBulkString(c.name)}${encodeInteger(c.pending)}`;
  });
  return `*4\r\n${encodeInteger(summary.count)}${encodeBulkString(summary.minId)}${encodeBulkString(summary.maxId)}${encodeInteger(consumerParts.length)}${consumerParts.join('')}`;
}

async function handleXclaim(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 5) return encodeError("wrong number of arguments for 'XCLAIM' command");
  const key = args[0];
  const group = args[1];
  const consumer = args[2];
  const minIdleTime = parseInt(args[3]);
  if (isNaN(minIdleTime)) return encodeError('ERR value is not an integer or out of range');
  // Parse IDs until we hit a flag
  const ids: string[] = [];
  let i = 4;
  while (
    i < args.length &&
    !args[i].toUpperCase().startsWith('IDLE') &&
    !args[i].toUpperCase().startsWith('TIME') &&
    !args[i].toUpperCase().startsWith('RETRYCOUNT') &&
    args[i].toUpperCase() !== 'FORCE' &&
    args[i].toUpperCase() !== 'JUSTID'
  ) {
    ids.push(args[i]);
    i++;
  }
  if (ids.length === 0) return encodeError("wrong number of arguments for 'XCLAIM' command");
  let idle: number | undefined;
  let time: number | undefined;
  let retrycount: number | undefined;
  let force = false;
  let justid = false;
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    if (opt === 'IDLE') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      idle = parseInt(args[i]);
      if (isNaN(idle)) return encodeError('ERR value is not an integer or out of range');
      i++;
    } else if (opt === 'TIME') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      time = parseInt(args[i]);
      if (isNaN(time)) return encodeError('ERR value is not an integer or out of range');
      i++;
    } else if (opt === 'RETRYCOUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      retrycount = parseInt(args[i]);
      if (isNaN(retrycount)) return encodeError('ERR value is not an integer or out of range');
      i++;
    } else if (opt === 'FORCE') {
      force = true;
      i++;
    } else if (opt === 'JUSTID') {
      justid = true;
      i++;
    } else {
      // Treat as ID
      ids.push(args[i]);
      i++;
    }
  }
  const options: {
    idle?: number;
    time?: number;
    retrycount?: number;
    force?: boolean;
    justid?: boolean;
  } = {};
  if (idle !== undefined) options.idle = idle;
  if (time !== undefined) options.time = time;
  if (retrycount !== undefined) options.retrycount = retrycount;
  if (force) options.force = true;
  if (justid) options.justid = true;

  const result = await ctx.storage.xclaim(key, group, consumer, minIdleTime, ids, options);
  if (justid) {
    // Result is string[] (just IDs)
    const idList = result as string[];
    return encodeArray(idList);
  }
  // Result is StreamEntry[]
  const entries = result as StreamEntry[];
  const parts = entries.map((e) => encodeStreamEntry(e));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleXautoclaim(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 5) return encodeError("wrong number of arguments for 'XAUTOCLAIM' command");
  const key = args[0];
  const group = args[1];
  const consumer = args[2];
  const minIdleTime = parseInt(args[3]);
  if (isNaN(minIdleTime)) return encodeError('ERR value is not an integer or out of range');
  const start = args[4];
  let count: number | undefined;
  let justid = false;
  for (let i = 5; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'COUNT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    } else if (opt === 'JUSTID') {
      justid = true;
    }
  }
  const options: { count?: number; justid?: boolean } = {};
  if (count !== undefined) options.count = count;
  if (justid) options.justid = true;

  const result = await ctx.storage.xautoclaim(key, group, consumer, minIdleTime, start, options);
  if (justid) {
    // Result.entries is string[]
    const entries = result.entries as string[];
    return `*2\r\n${encodeBulkString(result.nextStartId)}${encodeArray(entries)}`;
  }
  // Result.entries is StreamEntry[]
  const entries = result.entries as StreamEntry[];
  const parts = entries.map((e) => encodeStreamEntry(e));
  return `*2\r\n${encodeBulkString(result.nextStartId)}*${parts.length}\r\n${parts.join('')}`;
}

async function handleXinfo(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'XINFO' command");
  const sub = args[0].toUpperCase();
  switch (sub) {
    case 'STREAM':
      return await handleXinfoStream(ctx, args.slice(1));
    case 'GROUPS':
      return await handleXinfoGroups(ctx, args.slice(1));
    case 'CONSUMERS':
      return await handleXinfoConsumers(ctx, args.slice(1));
    default:
      return encodeError(`unknown subcommand '${args[0]}'`);
  }
}

async function handleXinfoStream(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'XINFO STREAM' command");
  const key = args[0];
  const result = await ctx.storage.xinfoStream(key);
  // Return as flat array of field-value pairs
  const items: string[] = [
    'length',
    String(result.length),
    'first-entry',
    result.firstEntry ? encodeStreamEntry(result.firstEntry) : encodeBulkString(null),
    'last-entry',
    result.lastEntry ? encodeStreamEntry(result.lastEntry) : encodeBulkString(null),
    'max-deleted-entry-id',
    String(result.maxDeletedEntryId),
    'entries-added',
    String(result.entriesAdded),
    'recorded-first-entry-id',
    String(result.recordedFirstEntryId),
    'groups',
    String(result.groups),
  ];
  return encodeArray(items);
}

async function handleXinfoGroups(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'XINFO GROUPS' command");
  const key = args[0];
  const result = await ctx.storage.xinfoGroups(key);
  const parts = result.map((g) => {
    const items = [
      'name',
      g.name,
      'consumers',
      String(g.consumers),
      'pending',
      String(g.pending),
      'last-delivered-id',
      g.lastDeliveredId,
      'entries-read',
      String(g.entriesRead),
      'lag',
      String(g.lag),
    ];
    return encodeArray(items);
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleXinfoConsumers(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2)
    return encodeError("wrong number of arguments for 'XINFO CONSUMERS' command");
  const key = args[0];
  const group = args[1];
  const result = await ctx.storage.xinfoConsumers(key, group);
  const parts = result.map((c) => {
    const items = ['name', c.name, 'pending', String(c.pendingCount), 'idle', String(c.idleTime)];
    return encodeArray(items);
  });
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleXsetid(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'XSETID' command");
  const key = args[0];
  const id = args[1];
  const result = await ctx.storage.xsetid(key, id);
  return encodeSimpleString(result);
}