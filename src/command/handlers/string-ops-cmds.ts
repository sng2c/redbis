import { HandlerContext, CommandFn } from '../context';
import { encodeSimpleString, encodeError, encodeInteger, encodeBulkString, encodeArray } from '../../protocol/resp';

export function registerStringOpsCommands(registry: Map<string, CommandFn>): void {
  registry.set('SET', handleSet);
  registry.set('GET', handleGet);
  registry.set('DEL', handleDel);
  registry.set('KEYS', handleKeys);
  registry.set('EXISTS', handleExists);
  registry.set('FLUSHDB', handleFlushdb);
  registry.set('FLUSHALL', handleFlushdb);
  registry.set('MGET', handleMget);
  registry.set('MSET', handleMset);
  registry.set('MSETNX', handleMsetnx);
  registry.set('APPEND', handleAppend);
  registry.set('STRLEN', handleStrlen);
  registry.set('GETRANGE', handleGetrange);
  registry.set('SETRANGE', handleSetrange);
  registry.set('INCR', handleIncr);
  registry.set('DECR', handleDecr);
  registry.set('INCRBY', handleIncrby);
  registry.set('DECRBY', handleDecrby);
  registry.set('INCRBYFLOAT', handleIncrbyfloat);
  registry.set('SETNX', handleSetnx);
  registry.set('SETEX', handleSetex);
  registry.set('PSETEX', handlePsetex);
  registry.set('GETSET', handleGetset);
  registry.set('GETDEL', handleGetdel);
  registry.set('GETEX', handleGetex);
  registry.set('LCS', handleLcs);
}

// === Basic commands ===

async function handleSet(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'SET' command");
  }

  const key = args[0];
  const value = args[1];

  let ex: number | undefined;
  let px: number | undefined;
  let exat: number | undefined;
  let pxat: number | undefined;
  let nx = false;
  let xx = false;
  let get = false;
  let keepttl = false;

  for (let i = 2; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    switch (opt) {
      case 'EX': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        ex = parseInt(args[i]);
        if (isNaN(ex) || ex <= 0) return encodeError('ERR invalid expire time in set');
        break;
      }
      case 'PX': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        px = parseInt(args[i]);
        if (isNaN(px) || px <= 0) return encodeError('ERR invalid expire time in set');
        break;
      }
      case 'EXAT': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        exat = parseInt(args[i]);
        if (isNaN(exat) || exat <= 0) return encodeError('ERR invalid expire time in set');
        break;
      }
      case 'PXAT': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        pxat = parseInt(args[i]);
        if (isNaN(pxat) || pxat <= 0) return encodeError('ERR invalid expire time in set');
        break;
      }
      case 'NX':
        nx = true;
        break;
      case 'XX':
        xx = true;
        break;
      case 'GET':
        get = true;
        break;
      case 'KEEPTTL':
        keepttl = true;
        break;
      default:
        // Unknown option — skip silently for backward compat
        break;
    }
  }

  // Save pttl before any modification if KEEPTTL is specified
  let savedPttl: number | null = null;
  if (keepttl) {
    const pt = await ctx.storage.pttl(key);
    if (pt > 0) {
      savedPttl = pt;
    }
    // -1 means no expiry, -2 means key doesn't exist
    // For -1, set() will clear expiry → that's fine (keepttl means keep existing, no expiry is "existing")
    // For -2, key doesn't exist, so no TTL to preserve
  }

  // NX/XX check
  if (nx || xx) {
    const existing = await ctx.storage.get(key);
    if (nx && existing !== null) {
      // Key exists, NX fails
      if (get) {
        return encodeBulkString(existing);
      }
      return encodeBulkString(null);
    }
    if (xx && existing === null) {
      // Key doesn't exist, XX fails
      return encodeBulkString(null);
    }
  }

  // Save old value for GET flag
  let oldValue: string | null = null;
  if (get) {
    oldValue = await ctx.storage.get(key);
  }

  // Set the value
  await ctx.storage.set(key, value);

  // Handle expiry
  if (keepttl) {
    // Restore saved TTL (if any)
    if (savedPttl !== null && savedPttl > 0) {
      await ctx.storage.pexpire(key, savedPttl);
    }
    // If savedPttl was null, set() already cleared expiry, which is correct for no-expiry or non-existing keys
  } else if (ex !== undefined) {
    await ctx.storage.expire(key, ex);
  } else if (px !== undefined) {
    await ctx.storage.pexpire(key, px);
  } else if (exat !== undefined) {
    await ctx.storage.expireat(key, exat);
  } else if (pxat !== undefined) {
    await ctx.storage.pexpireat(key, pxat);
  }

  if (get) {
    return encodeBulkString(oldValue);
  }
  return encodeSimpleString('OK');
}

async function handleGet(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'GET' command");
  }
  const value = await ctx.storage.get(args[0]);
  return encodeBulkString(value);
}

async function handleDel(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length === 0) {
    return encodeError("wrong number of arguments for 'DEL' command");
  }
  let count = 0;
  for (const key of args) {
    const existed = await ctx.storage.delete(key);
    if (existed) count++;
  }
  return encodeInteger(count);
}

async function handleKeys(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length === 0) {
    return encodeError("wrong number of arguments for 'KEYS' command");
  }
  const matchingKeys = await ctx.storage.keys(args[0]);
  return encodeArray(matchingKeys);
}

async function handleExists(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length === 0) {
    return encodeError("wrong number of arguments for 'EXISTS' command");
  }
  let count = 0;
  for (const key of args) {
    const value = await ctx.storage.get(key);
    if (value !== null) count++;
  }
  return encodeInteger(count);
}

async function handleFlushdb(ctx: HandlerContext, args: string[]): Promise<string> {
  await ctx.storage.flush();
  return encodeSimpleString('OK');
}

// === Multi-key ===

async function handleMget(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length === 0) {
    return encodeError("wrong number of arguments for 'MGET' command");
  }
  const results = await ctx.storage.mget(args);
  const parts = results.map((r) => (r === null ? encodeBulkString(null) : encodeBulkString(r)));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleMset(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2 || args.length % 2 !== 0) {
    return encodeError("wrong number of arguments for 'MSET' command");
  }
  const pairs: Array<{ key: string; value: string }> = [];
  for (let i = 0; i < args.length; i += 2) {
    pairs.push({ key: args[i], value: args[i + 1] });
  }
  await ctx.storage.mset(pairs);
  return encodeSimpleString('OK');
}

async function handleMsetnx(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2 || args.length % 2 !== 0) {
    return encodeError("wrong number of arguments for 'MSETNX' command");
  }
  const pairs: Array<{ key: string; value: string }> = [];
  for (let i = 0; i < args.length; i += 2) {
    pairs.push({ key: args[i], value: args[i + 1] });
  }
  const result = await ctx.storage.msetnx(pairs);
  return encodeInteger(result ? 1 : 0);
}

// === String operations ===

async function handleAppend(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'APPEND' command");
  }
  const result = await ctx.storage.append(args[0], args[1]);
  return encodeInteger(result);
}

async function handleStrlen(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'STRLEN' command");
  }
  const result = await ctx.storage.strlen(args[0]);
  return encodeInteger(result);
}

async function handleGetrange(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'GETRANGE' command");
  }
  const start = parseInt(args[1]);
  const end = parseInt(args[2]);
  if (isNaN(start) || isNaN(end)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.getrange(args[0], start, end);
  return encodeBulkString(result);
}

async function handleSetrange(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'SETRANGE' command");
  }
  const offset = parseInt(args[1]);
  if (isNaN(offset)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.setrange(args[0], offset, args[2]);
  return encodeInteger(result);
}

async function handleIncr(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'INCR' command");
  }
  const result = await ctx.storage.incrby(args[0], 1);
  return encodeInteger(result);
}

async function handleDecr(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'DECR' command");
  }
  const result = await ctx.storage.incrby(args[0], -1);
  return encodeInteger(result);
}

async function handleIncrby(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'INCRBY' command");
  }
  const delta = parseInt(args[1]);
  if (isNaN(delta)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.incrby(args[0], delta);
  return encodeInteger(result);
}

async function handleDecrby(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'DECRBY' command");
  }
  const delta = parseInt(args[1]);
  if (isNaN(delta)) {
    return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.incrby(args[0], -delta);
  return encodeInteger(result);
}

async function handleIncrbyfloat(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'INCRBYFLOAT' command");
  }
  const delta = parseFloat(args[1]);
  if (isNaN(delta)) {
    return encodeError('ERR value is not a valid float');
  }
  const result = await ctx.storage.incrbyfloat(args[0], delta);
  return encodeBulkString(result);
}

// === Conditional set ===

async function handleSetnx(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'SETNX' command");
  }
  const result = await ctx.storage.setnx(args[0], args[1]);
  return encodeInteger(result ? 1 : 0);
}

async function handleSetex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'SETEX' command");
  }
  const seconds = parseInt(args[1]);
  if (isNaN(seconds) || seconds <= 0) {
    return encodeError('ERR invalid expire time in setex');
  }
  await ctx.storage.setex(args[0], seconds, args[2]);
  return encodeSimpleString('OK');
}

async function handlePsetex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) {
    return encodeError("wrong number of arguments for 'PSETEX' command");
  }
  const ms = parseInt(args[1]);
  if (isNaN(ms) || ms <= 0) {
    return encodeError('ERR invalid expire time in psetex');
  }
  await ctx.storage.psetex(args[0], ms, args[2]);
  return encodeSimpleString('OK');
}

async function handleGetset(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) {
    return encodeError("wrong number of arguments for 'GETSET' command");
  }
  const result = await ctx.storage.getset(args[0], args[1]);
  return encodeBulkString(result);
}

async function handleGetdel(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'GETDEL' command");
  }
  const result = await ctx.storage.getdel(args[0]);
  return encodeBulkString(result);
}

async function handleGetex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'GETEX' command");
  }
  const key = args[0];
  const options: { ex?: number; px?: number; exat?: number; pxat?: number; persist?: boolean } = {};

  for (let i = 1; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    switch (opt) {
      case 'EX': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        options.ex = parseInt(args[i]);
        if (isNaN(options.ex)) return encodeError('ERR value is not an integer or out of range');
        break;
      }
      case 'PX': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        options.px = parseInt(args[i]);
        if (isNaN(options.px)) return encodeError('ERR value is not an integer or out of range');
        break;
      }
      case 'EXAT': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        options.exat = parseInt(args[i]);
        if (isNaN(options.exat)) return encodeError('ERR value is not an integer or out of range');
        break;
      }
      case 'PXAT': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        options.pxat = parseInt(args[i]);
        if (isNaN(options.pxat)) return encodeError('ERR value is not an integer or out of range');
        break;
      }
      case 'PERSIST':
        options.persist = true;
        break;
      default:
        return encodeError('ERR syntax error');
    }
  }

  const result = await ctx.storage.getex(key, options);
  return encodeBulkString(result);
}

// === LCS ===

async function handleLcs(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) {
    return encodeError("wrong number of arguments for 'LCS' command");
  }

  const key1 = args[0];
  const key2 = args[1];
  let lenOnly = false;
  let idx = false;
  let minmatchlen = 0;
  let withmatchlen = false;

  for (let i = 2; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    switch (opt) {
      case 'LEN':
        lenOnly = true;
        break;
      case 'IDX':
        idx = true;
        break;
      case 'MINMATCHLEN': {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        minmatchlen = parseInt(args[i]);
        if (isNaN(minmatchlen)) return encodeError('ERR value is not an integer or out of range');
        break;
      }
      case 'WITHMATCHLEN':
        withmatchlen = true;
        break;
      default:
        return encodeError('ERR syntax error');
    }
  }

  const s1 = (await ctx.storage.get(key1)) ?? '';
  const s2 = (await ctx.storage.get(key2)) ?? '';
  const m = s1.length;
  const n = s2.length;

  // Build DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcsLen = dp[m][n];

  // LEN only
  if (lenOnly && !idx) {
    return encodeInteger(lcsLen);
  }

  // IDX mode
  if (idx) {
    // Find all matching positions by backtracking
    // Collect matches as [start1, end1, start2, end2] groups (in s1 and s2)
    type MatchRange = { start1: number; end1: number; start2: number; end2: number };
    const matches: MatchRange[] = [];

    // Backtrack to find all matching characters and their positions
    let i = m;
    let j = n;
    const lcsChars: { pos1: number; pos2: number }[] = [];
    while (i > 0 && j > 0) {
      if (s1[i - 1] === s2[j - 1]) {
        lcsChars.unshift({ pos1: i - 1, pos2: j - 1 });
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    // Group consecutive matching positions into ranges
    if (lcsChars.length > 0) {
      let currentMatch: MatchRange = {
        start1: lcsChars[0].pos1,
        end1: lcsChars[0].pos1,
        start2: lcsChars[0].pos2,
        end2: lcsChars[0].pos2,
      };
      for (let k = 1; k < lcsChars.length; k++) {
        const prev = lcsChars[k - 1];
        const curr = lcsChars[k];
        if (curr.pos1 === prev.pos1 + 1 && curr.pos2 === prev.pos2 + 1) {
          currentMatch.end1 = curr.pos1;
          currentMatch.end2 = curr.pos2;
        } else {
          if (currentMatch.end1 - currentMatch.start1 + 1 >= minmatchlen) {
            matches.push(currentMatch);
          }
          currentMatch = {
            start1: curr.pos1,
            end1: curr.pos1,
            start2: curr.pos2,
            end2: curr.pos2,
          };
        }
      }
      if (currentMatch.end1 - currentMatch.start1 + 1 >= minmatchlen) {
        matches.push(currentMatch);
      }
    }

    // Build RESP response:
    // *2\r\n
    // $7\r\nmatches\r\n
    // *N\r\n   (N = number of matches, each match is an array)
    //   *4\r\n (or *5 with WITHMATCHLEN)
    //   :start1\r\n:end1\r\n:start2\r\n:end2\r\n[:matchlen\r\n]
    // $3\r\nlen\r\n
    // :L\r\n
    const matchArrays: string[] = [];
    for (const match of matches) {
      const matchLen = match.end1 - match.start1 + 1;
      const items: string[] = [
        encodeInteger(match.start1),
        encodeInteger(match.end1),
        encodeInteger(match.start2),
        encodeInteger(match.end2),
      ];
      if (withmatchlen) {
        items.push(encodeInteger(matchLen));
      }
      matchArrays.push(`*${items.length}\r\n${items.join('')}`);
    }

    const matchesArr =
      matchArrays.length === 0 ? '*0\r\n' : `*${matchArrays.length}\r\n${matchArrays.join('')}`;

    return `*2\r\n$7\r\nmatches\r\n${matchesArr}$3\r\nlen\r\n${encodeInteger(lcsLen)}`;
  }

  // Default: return the LCS string as bulk string
  // Backtrack to find the LCS string
  let result = '';
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (s1[i - 1] === s2[j - 1]) {
      result = s1[i - 1] + result;
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return encodeBulkString(result);
}