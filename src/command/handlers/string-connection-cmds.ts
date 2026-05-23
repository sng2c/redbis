import { HandlerContext, CommandFn } from '../context';
import { encodeSimpleString, encodeError, encodeInteger, encodeBulkString, encodeArray, encodeRawArray } from '../../protocol/resp';

export function registerStringConnectionCommands(registry: Map<string, CommandFn>): void {
  registry.set('PING', handlePing);
  registry.set('ECHO', handleEcho);
  registry.set('QUIT', handleQuit);
  registry.set('COMMAND', handleCommand);
}

// === Connection commands ===

function handlePing(ctx: HandlerContext, args: string[]): string {
  if (args.length === 0) {
    return encodeSimpleString('PONG');
  }
  return encodeBulkString(args[0]);
}

function handleEcho(ctx: HandlerContext, args: string[]): string {
  if (args.length !== 1) {
    return encodeError("wrong number of arguments for 'ECHO' command");
  }
  return encodeBulkString(args[0]);
}

function handleQuit(ctx: HandlerContext, args: string[]): string {
  return encodeSimpleString('OK');
}

function getCommandList(): string[] {
  return [
    'PING',
    'SET',
    'GET',
    'DEL',
    'KEYS',
    'EXISTS',
    'FLUSHDB',
    'FLUSHALL',
    'COMMAND',
    'MGET',
    'MSET',
    'MSETNX',
    'APPEND',
    'STRLEN',
    'GETRANGE',
    'SETRANGE',
    'INCR',
    'DECR',
    'INCRBY',
    'DECRBY',
    'INCRBYFLOAT',
    'SETNX',
    'SETEX',
    'PSETEX',
    'GETSET',
    'GETDEL',
    'GETEX',
    'RENAME',
    'RENAMENX',
    'TYPE',
    'DBSIZE',
    'COPY',
    'RANDOMKEY',
    'UNLINK',
    'TOUCH',
    'SCAN',
    'EXPIRE',
    'EXPIREAT',
    'PEXPIRE',
    'PEXPIREAT',
    'TTL',
    'PTTL',
    'PERSIST',
    'EXPIRETIME',
    'PEXPIRETIME',
    'ECHO',
    'QUIT',
    'LCS',
    'SUBSCRIBE',
    'UNSUBSCRIBE',
    'PSUBSCRIBE',
    'PUNSUBSCRIBE',
    'PUBLISH',
    'SPUBLISH',
    'SSUBSCRIBE',
    'SUNSUBSCRIBE',
    'PUBSUB',
    'MULTI',
    'EXEC',
    'DISCARD',
    'INFO',
    'TIME',
    'LASTSAVE',
    'SAVE',
    'SHUTDOWN',
    'CONFIG',
    'SLOWLOG',
    'MEMORY',
    'HSET',
    'HGET',
    'HDEL',
    'HGETALL',
    'HKEYS',
    'HVALS',
    'HLEN',
    'HEXISTS',
    'HSETNX',
    'HMSET',
    'HMGET',
    'HINCRBY',
    'HINCRBYFLOAT',
    'HRANDFIELD',
    'HSCAN',
    'HSTRLEN',
    'HGETDEL',
    'HGETEX',
    'HSETEX',
    'HEXPIRE',
    'HEXPIREAT',
    'HPEXPIRE',
    'HPEXPIREAT',
    'HEXPIRETIME',
    'HPEXPIRETIME',
    'HPERSIST',
    'HTTL',
    'HPTTL',
    'LPUSH',
    'RPUSH',
    'LPOP',
    'RPOP',
    'LLEN',
    'LRANGE',
    'LINDEX',
    'LSET',
    'LREM',
    'LTRIM',
    'LPOS',
    'RPOPLPUSH',
    'LPUSHX',
    'RPUSHX',
    'LINSERT',
    'LMOVE',
    'BLPOP',
    'BRPOP',
    'BRPOPLPUSH',
    'BLMOVE',
    'LMPOP',
    'SADD',
    'SREM',
    'SMEMBERS',
    'SCARD',
    'SISMEMBER',
    'SMISMEMBER',
    'SRANDMEMBER',
    'SPOP',
    'SMOVE',
    'SDIFF',
    'SINTER',
    'SUNION',
    'SDIFFSTORE',
    'SINTERSTORE',
    'SUNIONSTORE',
    'SINTERCARD',
    'SSCAN',
    'ZADD',
    'ZREM',
    'ZSCORE',
    'ZCARD',
    'ZRANGE',
    'ZREVRANGE',
    'ZRANGEBYSCORE',
    'ZREVRANGEBYSCORE',
    'ZRANGEBYLEX',
    'ZREVRANGEBYLEX',
    'ZRANK',
    'ZREVRANK',
    'ZINCRBY',
    'ZCOUNT',
    'ZREMRANGEBYRANK',
    'ZREMRANGEBYSCORE',
    'ZREMRANGEBYLEX',
    'ZLEXCOUNT',
    'ZSCAN',
    'ZPOPMAX',
    'ZPOPMIN',
    'ZRANDMEMBER',
    'ZMSCORE',
    'ZRANGESTORE',
    'ZDIFF',
    'ZDIFFSTORE',
    'ZUNION',
    'ZUNIONSTORE',
    'ZINTER',
    'ZINTERSTORE',
    'ZINTERCARD',
    'BZPOPMAX',
    'BZPOPMIN',
    'BZMPOP',
    'ZMPOP',
    // Bitmap
    'SETBIT',
    'GETBIT',
    'BITCOUNT',
    'BITPOS',
    'BITOP',
    'BITFIELD',
    'BITFIELD_RO',
    // HyperLogLog
    'PFADD',
    'PFCOUNT',
    'PFMERGE',
    // JSON
    'JSON.SET',
    'JSON.GET',
    'JSON.DEL',
    'JSON.FORGET',
    'JSON.TYPE',
    'JSON.STRLEN',
    'JSON.STRAPPEND',
    'JSON.OBJKEYS',
    'JSON.OBJLEN',
    'JSON.ARRAPPEND',
    'JSON.ARRINDEX',
    'JSON.ARRINSERT',
    'JSON.ARRLEN',
    'JSON.ARRPOP',
    'JSON.ARRTRIM',
    'JSON.NUMINCRBY',
    'JSON.NUMMULTBY',
    'JSON.MGET',
    'JSON.MSET',
    'JSON.TOGGLE',
    'JSON.CLEAR',
    'JSON.DEBUG',
    'JSON.RESP',
    'JSON.MERGE',
    // GEO
    'GEOADD',
    'GEOHASH',
    'GEOPOS',
    'GEODIST',
    'GEORADIUS',
    'GEORADIUSBYMEMBER',
    'GEOSEARCH',
    'GEOSEARCHSTORE',
    'GEORADIUS_RO',
    'GEORADIUSBYMEMBER_RO',
    // Stream
    'XADD',
    'XTRIM',
    'XDEL',
    'XRANGE',
    'XREVRANGE',
    'XLEN',
    'XREAD',
    'XGROUP',
    'XREADGROUP',
    'XACK',
    'XPENDING',
    'XCLAIM',
    'XAUTOCLAIM',
    'XINFO',
    'XSETID',
    // Sort
    'SORT',
    'SORT_RO',
    // Connection / Server
    'AUTH',
    'HELLO',
    'RESET',
    'SELECT',
    'CLIENT',
    'BGSAVE',
    'DELEX',
    'MSETEX',
  ];
}

function handleCommand(ctx: HandlerContext, args: string[]): string {
  if (args.length === 0) {
    return encodeArray(getCommandList());
  }
  const sub = args[0].toUpperCase();
  switch (sub) {
    case 'COUNT':
      return encodeInteger(getCommandList().length);
    case 'INFO': {
      const results: string[] = [];
      for (let i = 1; i < args.length; i++) {
        const name = args[i].toUpperCase();
        // [name, arity, flags, first_key, last_key, step]
        const entry = `*6\r\n${encodeBulkString(name)}${encodeInteger(-2)}*0\r\n${encodeInteger(0)}${encodeInteger(0)}${encodeInteger(0)}`;
        results.push(entry);
      }
      return encodeRawArray(results);
    }
    case 'DOCS':
      return encodeArray(null);
    case 'LIST':
      return encodeArray(getCommandList());
    case 'GETKEYS':
      return handleCommandGetkeys(args.slice(1));
    case 'GETKEYSANDFLAGS':
      return handleCommandGetkeysandflags(args.slice(1));
    default:
      return encodeError('unknown subcommand');
  }
}

function handleCommandGetkeys(args: string[]): string {
  if (args.length === 0) return encodeError('wrong number of arguments for command');
  const cmd = args[0].toUpperCase();
  const keys: string[] = [];
  switch (cmd) {
    case 'GET':
    case 'DEL':
    case 'TYPE':
    case 'EXISTS':
    case 'INCR':
    case 'DECR':
    case 'INCRBY':
    case 'DECRBY':
    case 'INCRBYFLOAT':
    case 'EXPIRE':
    case 'EXPIREAT':
    case 'PEXPIRE':
    case 'PEXPIREAT':
    case 'TTL':
    case 'PTTL':
    case 'PERSIST':
    case 'EXPIRETIME':
    case 'PEXPIRETIME':
      if (args.length >= 2) keys.push(args[1]);
      break;
    case 'SET':
      if (args.length >= 2) keys.push(args[1]);
      break;
    case 'MGET':
      for (let i = 1; i < args.length; i++) keys.push(args[i]);
      break;
    case 'HGET':
    case 'HDEL':
    case 'HINCRBY':
    case 'HINCRBYFLOAT':
      if (args.length >= 2) keys.push(args[1]);
      break;
    case 'HSET':
    case 'HMSET':
    case 'HMGET':
      if (args.length >= 2) keys.push(args[1]);
      break;
    default:
      return encodeError('invalid command for getkeys');
  }
  return encodeArray(keys);
}

function handleCommandGetkeysandflags(args: string[]): string {
  if (args.length === 0) return encodeError('wrong number of arguments for command');
  const cmd = args[0].toUpperCase();
  const keys: string[] = [];
  switch (cmd) {
    case 'GET':
    case 'SET':
    case 'DEL':
    case 'TYPE':
    case 'EXISTS':
    case 'INCR':
    case 'DECR':
    case 'INCRBY':
    case 'DECRBY':
      if (args.length >= 2) keys.push(args[1]);
      break;
    case 'MGET':
      for (let i = 1; i < args.length; i++) keys.push(args[i]);
      break;
    case 'HGET':
    case 'HSET':
    case 'HDEL':
      if (args.length >= 2) keys.push(args[1]);
      break;
    default:
      return encodeError('invalid command for getkeysandflags');
  }
  const result: string[] = [];
  for (const key of keys) {
    result.push(`*2\r\n${encodeBulkString(key)}*1\r\n$2\r\nRW\r\n`);
  }
  return encodeRawArray(result);
}