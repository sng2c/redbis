import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeBulkString, encodeArray } from '../../protocol/resp';

export function registerZsetUnionCommands(registry: Map<string, CommandFn>): void {
  registry.set('ZDIFF', handleZdiff);
  registry.set('ZDIFFSTORE', handleZdiffstore);
  registry.set('ZUNION', handleZunion);
  registry.set('ZUNIONSTORE', handleZunionstore);
  registry.set('ZINTER', handleZinter);
  registry.set('ZINTERSTORE', handleZinterstore);
  registry.set('ZINTERCARD', handleZintercard);
}

async function handleZdiff(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'ZDIFF' command");
  }
  const numkeys = parseInt(args[0]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 1 + numkeys) {
    return encodeError("wrong number of arguments for 'ZDIFF' command");
  }
  const keys = args.slice(1, 1 + numkeys);
  let withScores = false;
  if (args.length > 1 + numkeys) {
    if (args[1 + numkeys].toUpperCase() === 'WITHSCORES') {
      withScores = true;
    }
  }
  const pairs = await ctx.storage.zdiff(keys);
  if (withScores) {
    const flat: string[] = [];
    for (const p of pairs) {
      flat.push(p.member, String(p.score));
    }
    return encodeArray(flat);
  }
  return encodeArray(pairs.map((p) => p.member));
}

async function handleZdiffstore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZDIFFSTORE' command");
  }
  const destination = args[0];
  const numkeys = parseInt(args[1]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 2 + numkeys) {
    return encodeError("wrong number of arguments for 'ZDIFFSTORE' command");
  }
  const keys = args.slice(2, 2 + numkeys);
  const result = await ctx.storage.zdiffstore(destination, keys);
  return encodeInteger(result);
}

async function handleZunion(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'ZUNION' command");
  }
  const numkeys = parseInt(args[0]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 1 + numkeys) {
    return encodeError("wrong number of arguments for 'ZUNION' command");
  }
  const keys = args.slice(1, 1 + numkeys);
  let weights: number[] | undefined;
  let aggregate: string | undefined;
  let withScores = false;
  for (let i = 1 + numkeys; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WEIGHTS') {
      weights = [];
      for (let j = 0; j < numkeys; j++) {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const w = parseFloat(args[i]);
        if (isNaN(w)) return encodeError('ERR weight value is not a float');
        weights.push(w);
      }
    } else if (opt === 'AGGREGATE') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      aggregate = args[i].toUpperCase();
      if (aggregate !== 'SUM' && aggregate !== 'MIN' && aggregate !== 'MAX') {
        return encodeError('ERR syntax error');
      }
    } else if (opt === 'WITHSCORES') {
      withScores = true;
    }
  }
  const options: { weights?: number[]; aggregate?: string } = {};
  if (weights) options.weights = weights;
  if (aggregate) options.aggregate = aggregate;
  const pairs = await ctx.storage.zunion(keys, options);
  if (withScores) {
    const flat: string[] = [];
    for (const p of pairs) {
      flat.push(p.member, String(p.score));
    }
    return encodeArray(flat);
  }
  return encodeArray(pairs.map((p) => p.member));
}

async function handleZunionstore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZUNIONSTORE' command");
  }
  const destination = args[0];
  const numkeys = parseInt(args[1]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 2 + numkeys) {
    return encodeError("wrong number of arguments for 'ZUNIONSTORE' command");
  }
  const keys = args.slice(2, 2 + numkeys);
  let weights: number[] | undefined;
  let aggregate: string | undefined;
  for (let i = 2 + numkeys; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WEIGHTS') {
      weights = [];
      for (let j = 0; j < numkeys; j++) {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const w = parseFloat(args[i]);
        if (isNaN(w)) return encodeError('ERR weight value is not a float');
        weights.push(w);
      }
    } else if (opt === 'AGGREGATE') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      aggregate = args[i].toUpperCase();
      if (aggregate !== 'SUM' && aggregate !== 'MIN' && aggregate !== 'MAX') {
        return encodeError('ERR syntax error');
      }
    }
  }
  const options: { weights?: number[]; aggregate?: string } = {};
  if (weights) options.weights = weights;
  if (aggregate) options.aggregate = aggregate;
  const result = await ctx.storage.zunionstore(destination, keys, options);
  return encodeInteger(result);
}

async function handleZinter(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'ZINTER' command");
  }
  const numkeys = parseInt(args[0]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 1 + numkeys) {
    return encodeError("wrong number of arguments for 'ZINTER' command");
  }
  const keys = args.slice(1, 1 + numkeys);
  let weights: number[] | undefined;
  let aggregate: string | undefined;
  let withScores = false;
  for (let i = 1 + numkeys; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WEIGHTS') {
      weights = [];
      for (let j = 0; j < numkeys; j++) {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const w = parseFloat(args[i]);
        if (isNaN(w)) return encodeError('ERR weight value is not a float');
        weights.push(w);
      }
    } else if (opt === 'AGGREGATE') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      aggregate = args[i].toUpperCase();
      if (aggregate !== 'SUM' && aggregate !== 'MIN' && aggregate !== 'MAX') {
        return encodeError('ERR syntax error');
      }
    } else if (opt === 'WITHSCORES') {
      withScores = true;
    }
  }
  const options: { weights?: number[]; aggregate?: string } = {};
  if (weights) options.weights = weights;
  if (aggregate) options.aggregate = aggregate;
  const pairs = await ctx.storage.zinter(keys, options);
  if (withScores) {
    const flat: string[] = [];
    for (const p of pairs) {
      flat.push(p.member, String(p.score));
    }
    return encodeArray(flat);
  }
  return encodeArray(pairs.map((p) => p.member));
}

async function handleZinterstore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZINTERSTORE' command");
  }
  const destination = args[0];
  const numkeys = parseInt(args[1]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 2 + numkeys) {
    return encodeError("wrong number of arguments for 'ZINTERSTORE' command");
  }
  const keys = args.slice(2, 2 + numkeys);
  let weights: number[] | undefined;
  let aggregate: string | undefined;
  for (let i = 2 + numkeys; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WEIGHTS') {
      weights = [];
      for (let j = 0; j < numkeys; j++) {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const w = parseFloat(args[i]);
        if (isNaN(w)) return encodeError('ERR weight value is not a float');
        weights.push(w);
      }
    } else if (opt === 'AGGREGATE') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      aggregate = args[i].toUpperCase();
      if (aggregate !== 'SUM' && aggregate !== 'MIN' && aggregate !== 'MAX') {
        return encodeError('ERR syntax error');
      }
    }
  }
  const options: { weights?: number[]; aggregate?: string } = {};
  if (weights) options.weights = weights;
  if (aggregate) options.aggregate = aggregate;
  const result = await ctx.storage.zinterstore(destination, keys, options);
  return encodeInteger(result);
}

async function handleZintercard(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'ZINTERCARD' command");
  }
  const numkeys = parseInt(args[0]);
  if (isNaN(numkeys) || numkeys < 1) {
    return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length < 1 + numkeys) {
    return encodeError("wrong number of arguments for 'ZINTERCARD' command");
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
  const result = await ctx.storage.zintercard(keys, limit);
  return encodeInteger(result);
}