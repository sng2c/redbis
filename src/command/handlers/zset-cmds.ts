import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerZsetCommands(registry: Map<string, CommandFn>): void {
  registry.set('ZADD', handleZadd);
  registry.set('ZREM', handleZrem);
  registry.set('ZSCORE', handleZscore);
  registry.set('ZCARD', handleZcard);
  registry.set('ZRANGE', handleZrange);
  registry.set('ZREVRANGE', handleZrevrange);
  registry.set('ZRANGEBYSCORE', handleZrangebyscore);
  registry.set('ZREVRANGEBYSCORE', handleZrevrangebyscore);
  registry.set('ZRANGEBYLEX', handleZrangebylex);
  registry.set('ZREVRANGEBYLEX', handleZrevrangebylex);
  registry.set('ZRANK', handleZrank);
  registry.set('ZREVRANK', handleZrevrank);
  registry.set('ZINCRBY', handleZincrby);
  registry.set('ZCOUNT', handleZcount);
  registry.set('ZREMRANGEBYRANK', handleZremrangebyrank);
  registry.set('ZREMRANGEBYSCORE', handleZremrangebyscore);
  registry.set('ZREMRANGEBYLEX', handleZremrangebylex);
  registry.set('ZLEXCOUNT', handleZlexcount);
  registry.set('ZSCAN', handleZscan);
  registry.set('ZPOPMAX', handleZpopmax);
  registry.set('ZPOPMIN', handleZpopmin);
  registry.set('ZRANDMEMBER', handleZrandmember);
  registry.set('ZMSCORE', handleZmscore);
  registry.set('ZRANGESTORE', handleZrangestore);
  registry.set('ZDIFF', handleZdiff);
  registry.set('ZDIFFSTORE', handleZdiffstore);
  registry.set('ZUNION', handleZunion);
  registry.set('ZUNIONSTORE', handleZunionstore);
  registry.set('ZINTER', handleZinter);
  registry.set('ZINTERSTORE', handleZinterstore);
  registry.set('ZINTERCARD', handleZintercard);
  registry.set('BZPOPMAX', handleBzpopmax);
  registry.set('BZPOPMIN', handleBzpopmin);
  registry.set('BZMPOP', handleBzmpop);
  registry.set('ZMPOP', handleZmpop);
}

async function handleZadd(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZADD' command");
  }
  const key = args[0];
  let nx = false, xx = false, gt = false, lt = false, ch = false, incr = false;
  let i = 1;
  // Parse flags
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    if (opt === 'NX') { nx = true; i++; }
    else if (opt === 'XX') { xx = true; i++; }
    else if (opt === 'GT') { gt = true; i++; }
    else if (opt === 'LT') { lt = true; i++; }
    else if (opt === 'CH') { ch = true; i++; }
    else if (opt === 'INCR') { incr = true; i++; }
    else break;
  }
  // Remaining args are score-member pairs
  const remaining = args.length - i;
  if (remaining < 2 || remaining % 2 !== 0) {
    return encodeError("wrong number of arguments for 'ZADD' command");
  }
  const scoreMembers: Array<{ score: number; member: string }> = [];
  for (let j = i; j < args.length; j += 2) {
    const score = parseFloat(args[j]);
    if (isNaN(score)) {
      return encodeError('ERR value is not a valid float');
    }
    scoreMembers.push({ score, member: args[j + 1] });
  }
  if (incr && scoreMembers.length > 1) {
    return encodeError('ERR INCR option supports a single increment-element pair');
  }
  const options: { nx?: boolean; xx?: boolean; gt?: boolean; lt?: boolean; ch?: boolean; incr?: boolean } = {};
  if (nx) options.nx = true;
  if (xx) options.xx = true;
  if (gt) options.gt = true;
  if (lt) options.lt = true;
  if (ch) options.ch = true;
  if (incr) options.incr = true;
  const result = await ctx.storage.zadd(key, scoreMembers, options);
  if (incr) {
    // Result is string | null
    return encodeBulkString(result as string | null);
  }
  // Result is number
  return encodeInteger(result as number);
}

async function handleZrem(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'ZREM' command");
  }
  const key = args[0];
  const members = args.slice(1);
  const result = await ctx.storage.zrem(key, members);
  return encodeInteger(result);
}

async function handleZscore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'ZSCORE' command");
  }
  const result = await ctx.storage.zscore(args[0], args[1]);
  return encodeBulkString(result);
}

async function handleZcard(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'ZCARD' command");
  }
  const result = await ctx.storage.zcard(args[0]);
  return encodeInteger(result);
}

async function handleZrange(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZRANGE' command");
  }
  const key = args[0];
  const min = args[1];
  const max = args[2];
  let byScore = false, byLex = false, rev = false, withScores = false;
  let offset: number | undefined, count: number | undefined;
  for (let i = 3; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'BYSCORE') { byScore = true; }
    else if (opt === 'BYLEX') { byLex = true; }
    else if (opt === 'REV') { rev = true; }
    else if (opt === 'WITHSCORES') { withScores = true; }
    else if (opt === 'LIMIT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const options: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number } = {};
  if (byScore) options.byScore = true;
  if (byLex) options.byLex = true;
  if (rev) options.rev = true;
  if (offset !== undefined) options.offset = offset;
  if (count !== undefined) options.count = count;
  const pairs = await ctx.storage.zrange(key, min, max, options);
  if (withScores) {
    const flat: string[] = [];
    for (const p of pairs) {
      flat.push(p.member, String(p.score));
    }
    return encodeArray(flat);
  }
  return encodeArray(pairs.map(p => p.member));
}

async function handleZrevrange(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZREVRANGE' command");
  }
  const key = args[0];
  const min = args[1];
  const max = args[2];
  let withScores = false;
  for (let i = 3; i < args.length; i++) {
    if (args[i].toUpperCase() === 'WITHSCORES') { withScores = true; }
  }
  const pairs = await ctx.storage.zrange(key, min, max, { rev: true });
  if (withScores) {
    const flat: string[] = [];
    for (const p of pairs) {
      flat.push(p.member, String(p.score));
    }
    return encodeArray(flat);
  }
  return encodeArray(pairs.map(p => p.member));
}

async function handleZrangebyscore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZRANGEBYSCORE' command");
  }
  const key = args[0];
  const min = args[1];
  const max = args[2];
  let withScores = false;
  let offset: number | undefined, count: number | undefined;
  for (let i = 3; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WITHSCORES') { withScores = true; }
    else if (opt === 'LIMIT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const options: { byScore: boolean; rev?: boolean; offset?: number; count?: number } = { byScore: true };
  if (offset !== undefined) options.offset = offset;
  if (count !== undefined) options.count = count;
  const pairs = await ctx.storage.zrange(key, min, max, options);
  if (withScores) {
    const flat: string[] = [];
    for (const p of pairs) {
      flat.push(p.member, String(p.score));
    }
    return encodeArray(flat);
  }
  return encodeArray(pairs.map(p => p.member));
}

async function handleZrevrangebyscore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZREVRANGEBYSCORE' command");
  }
  const key = args[0];
  // Note: ZREVRANGEBYSCORE args are max min (reversed)
  const max = args[1];
  const min = args[2];
  let withScores = false;
  let offset: number | undefined, count: number | undefined;
  for (let i = 3; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'WITHSCORES') { withScores = true; }
    else if (opt === 'LIMIT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const options: { byScore: boolean; rev: boolean; offset?: number; count?: number } = { byScore: true, rev: true };
  if (offset !== undefined) options.offset = offset;
  if (count !== undefined) options.count = count;
  const pairs = await ctx.storage.zrange(key, max, min, options);
  if (withScores) {
    const flat: string[] = [];
    for (const p of pairs) {
      flat.push(p.member, String(p.score));
    }
    return encodeArray(flat);
  }
  return encodeArray(pairs.map(p => p.member));
}

async function handleZrangebylex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZRANGEBYLEX' command");
  }
  const key = args[0];
  const min = args[1];
  const max = args[2];
  let offset: number | undefined, count: number | undefined;
  for (let i = 3; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'LIMIT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const options: { byLex: boolean; offset?: number; count?: number } = { byLex: true };
  if (offset !== undefined) options.offset = offset;
  if (count !== undefined) options.count = count;
  const pairs = await ctx.storage.zrange(key, min, max, options);
  return encodeArray(pairs.map(p => p.member));
}

async function handleZrevrangebylex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) {
    return encodeError("wrong number of arguments for 'ZREVRANGEBYLEX' command");
  }
  const key = args[0];
  // Note: ZREVRANGEBYLEX args are max min (reversed)
  const max = args[1];
  const min = args[2];
  let offset: number | undefined, count: number | undefined;
  for (let i = 3; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'LIMIT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const options: { byLex: boolean; rev: boolean; offset?: number; count?: number } = { byLex: true, rev: true };
  if (offset !== undefined) options.offset = offset;
  if (count !== undefined) options.count = count;
  const pairs = await ctx.storage.zrange(key, max, min, options);
  return encodeArray(pairs.map(p => p.member));
}

async function handleZrank(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'ZRANK' command");
  }
  const result = await ctx.storage.zrank(args[0], args[1]);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleZrevrank(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'ZREVRANK' command");
  }
  const result = await ctx.storage.zrevrank(args[0], args[1]);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleZincrby(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'ZINCRBY' command");
  }
  const increment = parseFloat(args[1]);
  if (isNaN(increment)) {
    return encodeError('ERR value is not a valid float');
  }
  const result = await ctx.storage.zincrby(args[0], increment, args[2]);
  return encodeBulkString(result);
}

async function handleZcount(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'ZCOUNT' command");
  }
  const result = await ctx.storage.zcount(args[0], args[1], args[2]);
  return encodeInteger(result);
}

async function handleZremrangebyrank(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'ZREMRANGEBYRANK' command");
  }
  const start = parseInt(args[1]);
  const stop = parseInt(args[2]);
  if (isNaN(start) || isNaN(stop)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.zremrangebyrank(args[0], start, stop);
  return encodeInteger(result);
}

async function handleZremrangebyscore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'ZREMRANGEBYSCORE' command");
  }
  const result = await ctx.storage.zremrangebyscore(args[0], args[1], args[2]);
  return encodeInteger(result);
}

async function handleZremrangebylex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'ZREMRANGEBYLEX' command");
  }
  const result = await ctx.storage.zremrangebylex(args[0], args[1], args[2]);
  return encodeInteger(result);
}

async function handleZlexcount(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'ZLEXCOUNT' command");
  }
  const result = await ctx.storage.zlexcount(args[0], args[1], args[2]);
  return encodeInteger(result);
}

async function handleZscan(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'ZSCAN' command");
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
  const result = await ctx.storage.zscan(key, cursor, pattern, count);
  const cursorStr = encodeBulkString(String(result[0]));
  const membersArr = encodeArray(result[1]);
  return `*2\r\n${cursorStr}${membersArr}`;
}

async function handleZpopmax(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1 || args.length > 2) {
    return encodeError("wrong number of arguments for 'ZPOPMAX' command");
  }
  const key = args[0];
  let count: number | undefined;
  if (args.length === 2) {
    count = parseInt(args[1]);
    if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.zpopmax(key, count);
  if (count === undefined) {
    // No count: return 2-element array or nil
    if (result.length === 0) return encodeBulkString(null);
    return encodeArray([result[0].member, String(result[0].score)]);
  }
  // With count: flat array [m1, s1, m2, s2, ...]
  const flat: string[] = [];
  for (const p of result) {
    flat.push(p.member, String(p.score));
  }
  return encodeArray(flat);
}

async function handleZpopmin(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1 || args.length > 2) {
    return encodeError("wrong number of arguments for 'ZPOPMIN' command");
  }
  const key = args[0];
  let count: number | undefined;
  if (args.length === 2) {
    count = parseInt(args[1]);
    if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.zpopmin(key, count);
  if (count === undefined) {
    if (result.length === 0) return encodeBulkString(null);
    return encodeArray([result[0].member, String(result[0].score)]);
  }
  const flat: string[] = [];
  for (const p of result) {
    flat.push(p.member, String(p.score));
  }
  return encodeArray(flat);
}

async function handleZrandmember(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'ZRANDMEMBER' command");
  }
  const key = args[0];
  let count: number | undefined;
  let withScores = false;
  if (args.length >= 2) {
    count = parseInt(args[1]);
    if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    if (args.length >= 3 && args[2].toUpperCase() === 'WITHSCORES') {
      withScores = true;
    }
  }
  const result = await ctx.storage.zrandmember(key, count);
  if (count === undefined) {
    // Single member
    if (result.length === 0) return encodeBulkString(null);
    return encodeBulkString(result[0].member);
  }
  if (withScores) {
    const flat: string[] = [];
    for (const p of result) {
      flat.push(p.member, String(p.score));
    }
    return encodeArray(flat);
  }
  return encodeArray(result.map(p => p.member));
}

async function handleZmscore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'ZMSCORE' command");
  }
  const key = args[0];
  const members = args.slice(1);
  const results = await ctx.storage.zmscore(key, members);
  const parts = results.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleZrangestore(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 4) {
    return encodeError("wrong number of arguments for 'ZRANGESTORE' command");
  }
  const destination = args[0];
  const source = args[1];
  const min = args[2];
  const max = args[3];
  let byScore = false, byLex = false, rev = false;
  let offset: number | undefined, count: number | undefined;
  for (let i = 4; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'BYSCORE') { byScore = true; }
    else if (opt === 'BYLEX') { byLex = true; }
    else if (opt === 'REV') { rev = true; }
    else if (opt === 'LIMIT') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      count = parseInt(args[i]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
  }
  const options: { byScore?: boolean; byLex?: boolean; rev?: boolean; offset?: number; count?: number } = {};
  if (byScore) options.byScore = true;
  if (byLex) options.byLex = true;
  if (rev) options.rev = true;
  if (offset !== undefined) options.offset = offset;
  if (count !== undefined) options.count = count;
  const result = await ctx.storage.zrangestore(destination, source, min, max, options);
  return encodeInteger(result);
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
  return encodeArray(pairs.map(p => p.member));
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
  return encodeArray(pairs.map(p => p.member));
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
  return encodeArray(pairs.map(p => p.member));
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
      if (isNaN(count) || count <= 0) return encodeError('ERR value is not an integer or out of range');
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
      if (isNaN(count) || count <= 0) return encodeError('ERR value is not an integer or out of range');
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