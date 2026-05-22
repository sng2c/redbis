// Redis 명령 핸들러
// 파싱된 명령을 받아 스토리지에 대한 CRUD 작업을 수행하고
// RESP 프로토콜 형식의 응답을 반환합니다.

import { IStorage } from '../storage/interface';
import { PubSubManager } from '../pubsub/manager';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../protocol/resp';

// Slow log support
interface SlowLogEntry { timestamp: number; command: string[]; duration: number; }
const slowLog: SlowLogEntry[] = [];
let slowLogId = 0;
const SLOWLOG_MAX = 128;
const SLOWLOG_SLOW_THRESHOLD = 10; // ms

/** Encode a RESP array with pre-encoded (raw) RESP elements. */
function encodeRawArray(items: string[]): string {
  return `*${items.length}\r\n${items.join('')}`;
}

export class CommandHandler {
  private storage: IStorage;
  private pubsub: PubSubManager;
  private connId: string;
  private send: (msg: string) => void;

  // Transaction state
  private inMulti: boolean = false;
  private multiQueue: string[][] = [];

  constructor(storage: IStorage, pubsub: PubSubManager, connId: string, send: (msg: string) => void) {
    this.storage = storage;
    this.pubsub = pubsub;
    this.connId = connId;
    this.send = send;
  }

  /** Clean up PubSub subscriptions when connection closes. */
  destroy(): void {
    this.pubsub.unsubscribeAll(this.connId);
  }

  async execute(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError('unknown command');
    }

    const command = args[0].toUpperCase();

    // Transaction queuing: when in MULTI, most commands are queued
    if (this.inMulti) {
      if (command === 'MULTI') {
        return encodeError('MULTI calls can not be nested');
      }
      if (command === 'EXEC' || command === 'DISCARD') {
        // These control the transaction - fall through to dispatch
      } else {
        this.multiQueue.push(args);
        return encodeSimpleString('QUEUED');
      }
    }

    try {
      switch (command) {
        // Pub/Sub commands
        case 'SUBSCRIBE': return this.handleSubscribe(args.slice(1));
        case 'UNSUBSCRIBE': return this.handleUnsubscribe(args.slice(1));
        case 'PSUBSCRIBE': return this.handlePsubscribe(args.slice(1));
        case 'PUNSUBSCRIBE': return this.handlePunsubscribe(args.slice(1));
        case 'PUBLISH': return await this.handlePublish(args.slice(1));
        case 'SPUBLISH': return await this.handleSpublish(args.slice(1));
        case 'SSUBSCRIBE': return this.handleSsubscribe(args.slice(1));
        case 'SUNSUBSCRIBE': return this.handleSunsubscribe(args.slice(1));
        case 'PUBSUB': return this.handlePubsub(args.slice(1));

        // Transaction commands
        case 'MULTI': return this.handleMulti();
        case 'EXEC': return await this.handleExec();
        case 'DISCARD': return this.handleDiscard();

        // Server commands
        case 'INFO': return await this.handleInfo(args.slice(1));
        case 'TIME': return this.handleTime();
        case 'LASTSAVE': return await this.handleLastsave();
        case 'SAVE': return await this.handleSave();
        case 'SHUTDOWN': return this.handleShutdown();
        case 'CONFIG': return this.handleConfig(args.slice(1));
        case 'SLOWLOG': return this.handleSlowlog(args.slice(1));
        case 'MEMORY': return await this.handleMemory(args.slice(1));
        case 'DBSIZE': return await this.handleDbsize();

        case 'PING':
          return this.ping(args.slice(1));
        case 'SET':
          return await this.handleSet(args.slice(1));
        case 'GET':
          return await this.handleGet(args.slice(1));
        case 'DEL':
          return await this.handleDel(args.slice(1));
        case 'KEYS':
          return await this.handleKeys(args.slice(1));
        case 'EXISTS':
          return await this.handleExists(args.slice(1));
        case 'FLUSHDB':
          return await this.handleFlushdb();
        case 'FLUSHALL':
          return await this.handleFlushdb();
        case 'COMMAND':
          return this.handleCommand(args.slice(1));

        // Multi-key
        case 'MGET':
          return await this.handleMget(args.slice(1));
        case 'MSET':
          return await this.handleMset(args.slice(1));
        case 'MSETNX':
          return await this.handleMsetnx(args.slice(1));

        // String operations
        case 'APPEND':
          return await this.handleAppend(args.slice(1));
        case 'STRLEN':
          return await this.handleStrlen(args.slice(1));
        case 'GETRANGE':
          return await this.handleGetrange(args.slice(1));
        case 'SETRANGE':
          return await this.handleSetrange(args.slice(1));
        case 'INCR':
          return await this.handleIncr(args.slice(1));
        case 'DECR':
          return await this.handleDecr(args.slice(1));
        case 'INCRBY':
          return await this.handleIncrby(args.slice(1));
        case 'DECRBY':
          return await this.handleDecrby(args.slice(1));
        case 'INCRBYFLOAT':
          return await this.handleIncrbyfloat(args.slice(1));

        // Conditional set
        case 'SETNX':
          return await this.handleSetnx(args.slice(1));
        case 'SETEX':
          return await this.handleSetex(args.slice(1));
        case 'PSETEX':
          return await this.handlePsetex(args.slice(1));
        case 'GETSET':
          return await this.handleGetset(args.slice(1));
        case 'GETDEL':
          return await this.handleGetdel(args.slice(1));
        case 'GETEX':
          return await this.handleGetex(args.slice(1));

        // Key management
        case 'RENAME':
          return await this.handleRename(args.slice(1));
        case 'RENAMENX':
          return await this.handleRenamenx(args.slice(1));
        case 'TYPE':
          return await this.handleType(args.slice(1));

        case 'COPY':
          return await this.handleCopy(args.slice(1));
        case 'RANDOMKEY':
          return await this.handleRandomkey();
        case 'UNLINK':
          return await this.handleUnlink(args.slice(1));
        case 'TOUCH':
          return await this.handleTouch(args.slice(1));
        case 'SCAN':
          return await this.handleScan(args.slice(1));

        // Expiry
        case 'EXPIRE':
          return await this.handleExpire(args.slice(1));
        case 'EXPIREAT':
          return await this.handleExpireat(args.slice(1));
        case 'PEXPIRE':
          return await this.handlePexpire(args.slice(1));
        case 'PEXPIREAT':
          return await this.handlePexpireat(args.slice(1));
        case 'TTL':
          return await this.handleTtl(args.slice(1));
        case 'PTTL':
          return await this.handlePttl(args.slice(1));
        case 'PERSIST':
          return await this.handlePersist(args.slice(1));
        case 'EXPIRETIME':
          return await this.handleExpiretime(args.slice(1));
        case 'PEXPIRETIME':
          return await this.handlePexpiretime(args.slice(1));

        // Connection
        case 'ECHO':
          return this.handleEcho(args.slice(1));
        case 'QUIT':
          return this.handleQuit();

        // LCS
        case 'LCS':
          return await this.handleLcs(args.slice(1));

        // Hash operations
        case 'HSET': return await this.handleHset(args.slice(1));
        case 'HGET': return await this.handleHget(args.slice(1));
        case 'HDEL': return await this.handleHdel(args.slice(1));
        case 'HGETALL': return await this.handleHgetall(args.slice(1));
        case 'HKEYS': return await this.handleHkeys(args.slice(1));
        case 'HVALS': return await this.handleHvals(args.slice(1));
        case 'HLEN': return await this.handleHlen(args.slice(1));
        case 'HEXISTS': return await this.handleHexists(args.slice(1));
        case 'HSETNX': return await this.handleHsetnx(args.slice(1));
        case 'HMSET': return await this.handleHmset(args.slice(1));
        case 'HMGET': return await this.handleHmget(args.slice(1));
        case 'HINCRBY': return await this.handleHincrby(args.slice(1));
        case 'HINCRBYFLOAT': return await this.handleHincrbyfloat(args.slice(1));
        case 'HRANDFIELD': return await this.handleHrandfield(args.slice(1));
        case 'HSCAN': return await this.handleHscan(args.slice(1));
        case 'HSTRLEN': return await this.handleHstrlen(args.slice(1));
        case 'HGETDEL': return await this.handleHgetdel(args.slice(1));
        case 'HGETEX': return await this.handleHgetex(args.slice(1));
        case 'HSETEX': return await this.handleHsetex(args.slice(1));
        case 'HEXPIRE': return await this.handleHexpire(args.slice(1));
        case 'HEXPIREAT': return await this.handleHexpireat(args.slice(1));
        case 'HPEXPIRE': return await this.handleHpexpire(args.slice(1));
        case 'HPEXPIREAT': return await this.handleHpexpireat(args.slice(1));
        case 'HEXPIRETIME': return await this.handleHexpiretime(args.slice(1));
        case 'HPEXPIRETIME': return await this.handleHpexpiretime(args.slice(1));
        case 'HPERSIST': return await this.handleHpersist(args.slice(1));
        case 'HTTL': return await this.handleHttl(args.slice(1));
        case 'HPTTL': return await this.handleHpttl(args.slice(1));

        // List operations
        case 'LPUSH': return await this.handleLpush(args.slice(1));
        case 'RPUSH': return await this.handleRpush(args.slice(1));
        case 'LPOP': return await this.handleLpop(args.slice(1));
        case 'RPOP': return await this.handleRpop(args.slice(1));
        case 'LLEN': return await this.handleLlen(args.slice(1));
        case 'LRANGE': return await this.handleLrange(args.slice(1));
        case 'LINDEX': return await this.handleLindex(args.slice(1));
        case 'LSET': return await this.handleLset(args.slice(1));
        case 'LREM': return await this.handleLrem(args.slice(1));
        case 'LTRIM': return await this.handleLtrim(args.slice(1));
        case 'LPOS': return await this.handleLpos(args.slice(1));
        case 'RPOPLPUSH': return await this.handleRpoplpush(args.slice(1));
        case 'LPUSHX': return await this.handleLpushx(args.slice(1));
        case 'RPUSHX': return await this.handleRpushx(args.slice(1));
        case 'LINSERT': return await this.handleLinsert(args.slice(1));
        case 'LMOVE': return await this.handleLmove(args.slice(1));
        case 'BLPOP': return await this.handleBlpop(args.slice(1));
        case 'BRPOP': return await this.handleBrpop(args.slice(1));
        case 'BRPOPLPUSH': return await this.handleBrpoplpush(args.slice(1));
        case 'BLMOVE': return await this.handleBlmove(args.slice(1));
        case 'LMPOP': return await this.handleLmpop(args.slice(1));

        // Set operations
        case 'SADD': return await this.handleSadd(args.slice(1));
        case 'SREM': return await this.handleSrem(args.slice(1));
        case 'SMEMBERS': return await this.handleSmembers(args.slice(1));
        case 'SCARD': return await this.handleScard(args.slice(1));
        case 'SISMEMBER': return await this.handleSismember(args.slice(1));
        case 'SMISMEMBER': return await this.handleSmismember(args.slice(1));
        case 'SRANDMEMBER': return await this.handleSrandmember(args.slice(1));
        case 'SPOP': return await this.handleSpop(args.slice(1));
        case 'SMOVE': return await this.handleSmove(args.slice(1));
        case 'SDIFF': return await this.handleSdiff(args.slice(1));
        case 'SINTER': return await this.handleSinter(args.slice(1));
        case 'SUNION': return await this.handleSunion(args.slice(1));
        case 'SDIFFSTORE': return await this.handleSdiffstore(args.slice(1));
        case 'SINTERSTORE': return await this.handleSinterstore(args.slice(1));
        case 'SUNIONSTORE': return await this.handleSunionstore(args.slice(1));
        case 'SINTERCARD': return await this.handleSintercard(args.slice(1));
        case 'SSCAN': return await this.handleSscan(args.slice(1));

        // Sorted Set operations
        case 'ZADD': return await this.handleZadd(args.slice(1));
        case 'ZREM': return await this.handleZrem(args.slice(1));
        case 'ZSCORE': return await this.handleZscore(args.slice(1));
        case 'ZCARD': return await this.handleZcard(args.slice(1));
        case 'ZRANGE': return await this.handleZrange(args.slice(1));
        case 'ZREVRANGE': return await this.handleZrevrange(args.slice(1));
        case 'ZRANGEBYSCORE': return await this.handleZrangebyscore(args.slice(1));
        case 'ZREVRANGEBYSCORE': return await this.handleZrevrangebyscore(args.slice(1));
        case 'ZRANGEBYLEX': return await this.handleZrangebylex(args.slice(1));
        case 'ZREVRANGEBYLEX': return await this.handleZrevrangebylex(args.slice(1));
        case 'ZRANK': return await this.handleZrank(args.slice(1));
        case 'ZREVRANK': return await this.handleZrevrank(args.slice(1));
        case 'ZINCRBY': return await this.handleZincrby(args.slice(1));
        case 'ZCOUNT': return await this.handleZcount(args.slice(1));
        case 'ZREMRANGEBYRANK': return await this.handleZremrangebyrank(args.slice(1));
        case 'ZREMRANGEBYSCORE': return await this.handleZremrangebyscore(args.slice(1));
        case 'ZREMRANGEBYLEX': return await this.handleZremrangebylex(args.slice(1));
        case 'ZLEXCOUNT': return await this.handleZlexcount(args.slice(1));
        case 'ZSCAN': return await this.handleZscan(args.slice(1));
        case 'ZPOPMAX': return await this.handleZpopmax(args.slice(1));
        case 'ZPOPMIN': return await this.handleZpopmin(args.slice(1));
        case 'ZRANDMEMBER': return await this.handleZrandmember(args.slice(1));
        case 'ZMSCORE': return await this.handleZmscore(args.slice(1));
        case 'ZRANGESTORE': return await this.handleZrangestore(args.slice(1));
        case 'ZDIFF': return await this.handleZdiff(args.slice(1));
        case 'ZDIFFSTORE': return await this.handleZdiffstore(args.slice(1));
        case 'ZUNION': return await this.handleZunion(args.slice(1));
        case 'ZUNIONSTORE': return await this.handleZunionstore(args.slice(1));
        case 'ZINTER': return await this.handleZinter(args.slice(1));
        case 'ZINTERSTORE': return await this.handleZinterstore(args.slice(1));
        case 'ZINTERCARD': return await this.handleZintercard(args.slice(1));
        case 'BZPOPMAX': return await this.handleBzpopmax(args.slice(1));
        case 'BZPOPMIN': return await this.handleBzpopmin(args.slice(1));
        case 'BZMPOP': return await this.handleBzmpop(args.slice(1));
        case 'ZMPOP': return await this.handleZmpop(args.slice(1));

        // Bitmap operations
        case 'SETBIT': return await this.handleSetbit(args.slice(1));
        case 'GETBIT': return await this.handleGetbit(args.slice(1));
        case 'BITCOUNT': return await this.handleBitcount(args.slice(1));
        case 'BITPOS': return await this.handleBitpos(args.slice(1));
        case 'BITOP': return await this.handleBitop(args.slice(1));
        case 'BITFIELD': return await this.handleBitfield(args.slice(1));
        case 'BITFIELD_RO': return await this.handleBitfieldRo(args.slice(1));

        // HyperLogLog operations
        case 'PFADD': return await this.handlePfadd(args.slice(1));
        case 'PFCOUNT': return await this.handlePfcount(args.slice(1));
        case 'PFMERGE': return await this.handlePfmerge(args.slice(1));

        // JSON operations
        case 'JSON.SET': return await this.handleJsonSet(args.slice(1));
        case 'JSON.GET': return await this.handleJsonGet(args.slice(1));
        case 'JSON.DEL': return await this.handleJsonDel(args.slice(1));
        case 'JSON.FORGET': return await this.handleJsonForget(args.slice(1));
        case 'JSON.TYPE': return await this.handleJsonType(args.slice(1));
        case 'JSON.STRLEN': return await this.handleJsonStrlen(args.slice(1));
        case 'JSON.STRAPPEND': return await this.handleJsonStrappend(args.slice(1));
        case 'JSON.OBJKEYS': return await this.handleJsonObjkeys(args.slice(1));
        case 'JSON.OBJLEN': return await this.handleJsonObjlen(args.slice(1));
        case 'JSON.ARRAPPEND': return await this.handleJsonArrappend(args.slice(1));
        case 'JSON.ARRINDEX': return await this.handleJsonArrindex(args.slice(1));
        case 'JSON.ARRINSERT': return await this.handleJsonArrinsert(args.slice(1));
        case 'JSON.ARRLEN': return await this.handleJsonArrlen(args.slice(1));
        case 'JSON.ARRPOP': return await this.handleJsonArrpop(args.slice(1));
        case 'JSON.ARRTRIM': return await this.handleJsonArrtrim(args.slice(1));
        case 'JSON.NUMINCRBY': return await this.handleJsonNumincrby(args.slice(1));
        case 'JSON.NUMMULTBY': return await this.handleJsonNummultby(args.slice(1));
        case 'JSON.MGET': return await this.handleJsonMget(args.slice(1));
        case 'JSON.MSET': return await this.handleJsonMset(args.slice(1));
        case 'JSON.TOGGLE': return await this.handleJsonToggle(args.slice(1));
        case 'JSON.CLEAR': return await this.handleJsonClear(args.slice(1));
        case 'JSON.DEBUG': return await this.handleJsonDebug(args.slice(1));
        case 'JSON.RESP': return await this.handleJsonResp(args.slice(1));
        case 'JSON.MERGE': return await this.handleJsonMerge(args.slice(1));

        // GEO operations
        case 'GEOADD': return await this.handleGeoadd(args.slice(1));
        case 'GEOHASH': return await this.handleGeohash(args.slice(1));
        case 'GEOPOS': return await this.handleGeopos(args.slice(1));
        case 'GEODIST': return await this.handleGeodist(args.slice(1));
        case 'GEORADIUS': return await this.handleGeoradius(args.slice(1));
        case 'GEORADIUSBYMEMBER': return await this.handleGeoradiusbymember(args.slice(1));
        case 'GEOSEARCH': return await this.handleGeosearch(args.slice(1));
        case 'GEOSEARCHSTORE': return await this.handleGeosearchstore(args.slice(1));
        case 'GEORADIUS_RO': return await this.handleGeoradiusRo(args.slice(1));
        case 'GEORADIUSBYMEMBER_RO': return await this.handleGeoradiusbymemberRo(args.slice(1));

        // Stream operations
        case 'XADD': return await this.handleXadd(args.slice(1));
        case 'XTRIM': return await this.handleXtrim(args.slice(1));
        case 'XDEL': return await this.handleXdel(args.slice(1));
        case 'XRANGE': return await this.handleXrange(args.slice(1));
        case 'XREVRANGE': return await this.handleXrevrange(args.slice(1));
        case 'XLEN': return await this.handleXlen(args.slice(1));
        case 'XREAD': return await this.handleXread(args.slice(1));
        case 'XGROUP': return await this.handleXgroup(args.slice(1));
        case 'XREADGROUP': return await this.handleXreadgroup(args.slice(1));
        case 'XACK': return await this.handleXack(args.slice(1));
        case 'XPENDING': return await this.handleXpending(args.slice(1));
        case 'XCLAIM': return await this.handleXclaim(args.slice(1));
        case 'XAUTOCLAIM': return await this.handleXautoclaim(args.slice(1));
        case 'XINFO': return await this.handleXinfo(args.slice(1));
        case 'XSETID': return await this.handleXsetid(args.slice(1));

        // Sort operations
        case 'SORT': return await this.handleSort(args.slice(1));
        case 'SORT_RO': return await this.handleSortRo(args.slice(1));

        default:
          return encodeError(`unknown command '${args[0]}'`);
      }
    } catch (e: any) {
      if (e.message.startsWith('WRONGTYPE')) {
        return `-${e.message}\r\n`;
      }
      return encodeError(e.message);
    }
  }

  // === Connection commands ===

  private ping(args: string[]): string {
    if (args.length === 0) {
      return encodeSimpleString('PONG');
    }
    return encodeBulkString(args[0]);
  }

  private handleEcho(args: string[]): string {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'ECHO' command");
    }
    return encodeBulkString(args[0]);
  }

  private handleQuit(): string {
    return encodeSimpleString('OK');
  }

  // === Basic commands ===

  private async handleSet(args: string[]): Promise<string> {
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
        case 'NX': nx = true; break;
        case 'XX': xx = true; break;
        case 'GET': get = true; break;
        case 'KEEPTTL': keepttl = true; break;
        default:
          // Unknown option — skip silently for backward compat
          break;
      }
    }

    // Save pttl before any modification if KEEPTTL is specified
    let savedPttl: number | null = null;
    if (keepttl) {
      const pt = await this.storage.pttl(key);
      if (pt > 0) {
        savedPttl = pt;
      }
      // -1 means no expiry, -2 means key doesn't exist
      // For -1, set() will clear expiry → that's fine (keepttl means keep existing, no expiry is "existing")
      // For -2, key doesn't exist, so no TTL to preserve
    }

    // NX/XX check
    if (nx || xx) {
      const existing = await this.storage.get(key);
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
      oldValue = await this.storage.get(key);
    }

    // Set the value
    await this.storage.set(key, value);

    // Handle expiry
    if (keepttl) {
      // Restore saved TTL (if any)
      if (savedPttl !== null && savedPttl > 0) {
        await this.storage.pexpire(key, savedPttl);
      }
      // If savedPttl was null, set() already cleared expiry, which is correct for no-expiry or non-existing keys
    } else if (ex !== undefined) {
      await this.storage.expire(key, ex);
    } else if (px !== undefined) {
      await this.storage.pexpire(key, px);
    } else if (exat !== undefined) {
      await this.storage.expireat(key, exat);
    } else if (pxat !== undefined) {
      await this.storage.pexpireat(key, pxat);
    }

    if (get) {
      return encodeBulkString(oldValue);
    }
    return encodeSimpleString('OK');
  }

  private async handleGet(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'GET' command");
    }
    const value = await this.storage.get(args[0]);
    return encodeBulkString(value);
  }

  private async handleDel(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError("wrong number of arguments for 'DEL' command");
    }
    let count = 0;
    for (const key of args) {
      const existed = await this.storage.delete(key);
      if (existed) count++;
    }
    return encodeInteger(count);
  }

  private async handleKeys(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError("wrong number of arguments for 'KEYS' command");
    }
    const matchingKeys = await this.storage.keys(args[0]);
    return encodeArray(matchingKeys);
  }

  private async handleExists(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError("wrong number of arguments for 'EXISTS' command");
    }
    let count = 0;
    for (const key of args) {
      const value = await this.storage.get(key);
      if (value !== null) count++;
    }
    return encodeInteger(count);
  }

  private async handleFlushdb(): Promise<string> {
    await this.storage.flush();
    return encodeSimpleString('OK');
  }

  private getCommandList(): string[] {
    return [
      'PING', 'SET', 'GET', 'DEL', 'KEYS', 'EXISTS', 'FLUSHDB', 'FLUSHALL', 'COMMAND',
      'MGET', 'MSET', 'MSETNX',
      'APPEND', 'STRLEN', 'GETRANGE', 'SETRANGE',
      'INCR', 'DECR', 'INCRBY', 'DECRBY', 'INCRBYFLOAT',
      'SETNX', 'SETEX', 'PSETEX', 'GETSET', 'GETDEL', 'GETEX',
      'RENAME', 'RENAMENX', 'TYPE', 'DBSIZE', 'COPY', 'RANDOMKEY', 'UNLINK', 'TOUCH', 'SCAN',
      'EXPIRE', 'EXPIREAT', 'PEXPIRE', 'PEXPIREAT', 'TTL', 'PTTL', 'PERSIST', 'EXPIRETIME', 'PEXPIRETIME',
      'ECHO', 'QUIT',
      'LCS',
      'SUBSCRIBE', 'UNSUBSCRIBE', 'PSUBSCRIBE', 'PUNSUBSCRIBE', 'PUBLISH',
      'SPUBLISH', 'SSUBSCRIBE', 'SUNSUBSCRIBE', 'PUBSUB',
      'MULTI', 'EXEC', 'DISCARD',
      'INFO', 'TIME', 'LASTSAVE', 'SAVE', 'SHUTDOWN', 'CONFIG', 'SLOWLOG', 'MEMORY',
      'HSET', 'HGET', 'HDEL', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS',
      'HSETNX', 'HMSET', 'HMGET', 'HINCRBY', 'HINCRBYFLOAT', 'HRANDFIELD', 'HSCAN',
      'HSTRLEN', 'HGETDEL', 'HGETEX', 'HSETEX',
      'HEXPIRE', 'HEXPIREAT', 'HPEXPIRE', 'HPEXPIREAT', 'HEXPIRETIME', 'HPEXPIRETIME',
      'HPERSIST', 'HTTL', 'HPTTL',
      'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LLEN', 'LRANGE', 'LINDEX',
      'LSET', 'LREM', 'LTRIM', 'LPOS', 'RPOPLPUSH', 'LPUSHX', 'RPUSHX',
      'LINSERT', 'LMOVE', 'BLPOP', 'BRPOP', 'BRPOPLPUSH', 'BLMOVE', 'LMPOP',
      'SADD', 'SREM', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'SMISMEMBER',
      'SRANDMEMBER', 'SPOP', 'SMOVE', 'SDIFF', 'SINTER', 'SUNION',
      'SDIFFSTORE', 'SINTERSTORE', 'SUNIONSTORE', 'SINTERCARD', 'SSCAN',
      'ZADD', 'ZREM', 'ZSCORE', 'ZCARD', 'ZRANGE', 'ZREVRANGE',
      'ZRANGEBYSCORE', 'ZREVRANGEBYSCORE', 'ZRANGEBYLEX', 'ZREVRANGEBYLEX',
      'ZRANK', 'ZREVRANK', 'ZINCRBY', 'ZCOUNT',
      'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE', 'ZREMRANGEBYLEX', 'ZLEXCOUNT',
      'ZSCAN', 'ZPOPMAX', 'ZPOPMIN', 'ZRANDMEMBER', 'ZMSCORE',
      'ZRANGESTORE', 'ZDIFF', 'ZDIFFSTORE', 'ZUNION', 'ZUNIONSTORE',
      'ZINTER', 'ZINTERSTORE', 'ZINTERCARD',
      'BZPOPMAX', 'BZPOPMIN', 'BZMPOP', 'ZMPOP',
      // Bitmap
      'SETBIT', 'GETBIT', 'BITCOUNT', 'BITPOS', 'BITOP', 'BITFIELD', 'BITFIELD_RO',
      // HyperLogLog
      'PFADD', 'PFCOUNT', 'PFMERGE',
      // JSON
      'JSON.SET', 'JSON.GET', 'JSON.DEL', 'JSON.FORGET', 'JSON.TYPE',
      'JSON.STRLEN', 'JSON.STRAPPEND', 'JSON.OBJKEYS', 'JSON.OBJLEN',
      'JSON.ARRAPPEND', 'JSON.ARRINDEX', 'JSON.ARRINSERT', 'JSON.ARRLEN',
      'JSON.ARRPOP', 'JSON.ARRTRIM', 'JSON.NUMINCRBY', 'JSON.NUMMULTBY',
      'JSON.MGET', 'JSON.MSET', 'JSON.TOGGLE', 'JSON.CLEAR',
      'JSON.DEBUG', 'JSON.RESP', 'JSON.MERGE',
      // GEO
      'GEOADD', 'GEOHASH', 'GEOPOS', 'GEODIST',
      'GEORADIUS', 'GEORADIUSBYMEMBER', 'GEOSEARCH', 'GEOSEARCHSTORE',
      'GEORADIUS_RO', 'GEORADIUSBYMEMBER_RO',
      // Stream
      'XADD', 'XTRIM', 'XDEL', 'XRANGE', 'XREVRANGE', 'XLEN',
      'XREAD', 'XGROUP', 'XREADGROUP', 'XACK', 'XPENDING',
      'XCLAIM', 'XAUTOCLAIM', 'XINFO', 'XSETID',
      // Sort
      'SORT', 'SORT_RO',
    ];
  }

  private handleCommand(subArgs: string[]): string {
    if (subArgs.length === 0) {
      return encodeArray(this.getCommandList());
    }
    const sub = subArgs[0].toUpperCase();
    switch (sub) {
      case 'COUNT': return encodeInteger(this.getCommandList().length);
      case 'INFO': {
        const results: string[] = [];
        for (let i = 1; i < subArgs.length; i++) {
          const name = subArgs[i].toUpperCase();
          // [name, arity, flags, first_key, last_key, step]
          const entry = `*6\r\n${encodeBulkString(name)}${encodeInteger(-2)}*0\r\n${encodeInteger(0)}${encodeInteger(0)}${encodeInteger(0)}`;
          results.push(entry);
        }
        return encodeRawArray(results);
      }
      case 'DOCS': return encodeArray(null);
      case 'LIST': return encodeArray(this.getCommandList());
      case 'GETKEYS': return this.handleCommandGetkeys(subArgs.slice(1));
      case 'GETKEYSANDFLAGS': return this.handleCommandGetkeysandflags(subArgs.slice(1));
      default: return encodeError('unknown subcommand');
    }
  }

  private handleCommandGetkeys(args: string[]): string {
    if (args.length === 0) return encodeError('wrong number of arguments for command');
    const cmd = args[0].toUpperCase();
    const keys: string[] = [];
    switch (cmd) {
      case 'GET': case 'DEL': case 'TYPE': case 'EXISTS':
      case 'INCR': case 'DECR': case 'INCRBY': case 'DECRBY': case 'INCRBYFLOAT':
      case 'EXPIRE': case 'EXPIREAT': case 'PEXPIRE': case 'PEXPIREAT':
      case 'TTL': case 'PTTL': case 'PERSIST': case 'EXPIRETIME': case 'PEXPIRETIME':
        if (args.length >= 2) keys.push(args[1]);
        break;
      case 'SET':
        if (args.length >= 2) keys.push(args[1]);
        break;
      case 'MGET':
        for (let i = 1; i < args.length; i++) keys.push(args[i]);
        break;
      case 'HGET': case 'HDEL': case 'HINCRBY': case 'HINCRBYFLOAT':
        if (args.length >= 2) keys.push(args[1]);
        break;
      case 'HSET': case 'HMSET': case 'HMGET':
        if (args.length >= 2) keys.push(args[1]);
        break;
      default:
        return encodeError('invalid command for getkeys');
    }
    return encodeArray(keys);
  }

  private handleCommandGetkeysandflags(args: string[]): string {
    if (args.length === 0) return encodeError('wrong number of arguments for command');
    const cmd = args[0].toUpperCase();
    const keys: string[] = [];
    switch (cmd) {
      case 'GET': case 'SET': case 'DEL': case 'TYPE': case 'EXISTS':
      case 'INCR': case 'DECR': case 'INCRBY': case 'DECRBY':
        if (args.length >= 2) keys.push(args[1]);
        break;
      case 'MGET':
        for (let i = 1; i < args.length; i++) keys.push(args[i]);
        break;
      case 'HGET': case 'HSET': case 'HDEL':
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

  // === Pub/Sub commands ===

  private handleSubscribe(channels: string[]): string {
    if (channels.length === 0) return encodeArray(null);
    const results = this.pubsub.subscribe(this.connId, channels, this.send);
    return results.join('');
  }

  private handleUnsubscribe(channels: string[]): string {
    const results = this.pubsub.unsubscribe(this.connId, channels.length === 0 ? [] : channels);
    return results.join('');
  }

  private handlePsubscribe(patterns: string[]): string {
    if (patterns.length === 0) return encodeArray(null);
    const results = this.pubsub.psubscribe(this.connId, patterns, this.send);
    return results.join('');
  }

  private handlePunsubscribe(patterns: string[]): string {
    const results = this.pubsub.punsubscribe(this.connId, patterns.length === 0 ? [] : patterns);
    return results.join('');
  }

  private async handlePublish(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError('wrong number of arguments for \'PUBLISH\' command');
    const count = this.pubsub.publish(args[0], args[1]);
    return encodeInteger(count);
  }

  private async handleSpublish(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError('wrong number of arguments for \'SPUBLISH\' command');
    const count = this.pubsub.publish(args[0], args[1]);
    return encodeInteger(count);
  }

  private handleSsubscribe(channels: string[]): string {
    if (channels.length === 0) return encodeArray(null);
    const results = this.pubsub.subscribe(this.connId, channels, this.send);
    return results.join('');
  }

  private handleSunsubscribe(channels: string[]): string {
    const results = this.pubsub.unsubscribe(this.connId, channels.length === 0 ? [] : channels);
    return results.join('');
  }

  private handlePubsub(subArgs: string[]): string {
    if (subArgs.length === 0) return encodeArray(null);
    const sub = subArgs[0].toUpperCase();
    switch (sub) {
      case 'CHANNELS': {
        const pattern = subArgs[1];
        const channels = this.pubsub.getChannels(pattern);
        return encodeArray(channels);
      }
      case 'NUMSUB': {
        const channels = subArgs.slice(1);
        const results = this.pubsub.getNumSub(channels);
        const flat: string[] = [];
        for (const [ch, count] of results) {
          flat.push(ch, String(count));
        }
        return encodeArray(flat);
      }
      case 'NUMPAT': {
        const count = this.pubsub.getNumPat();
        return encodeInteger(count);
      }
      case 'SHARDCHANNELS': {
        const pattern = subArgs[1];
        const channels = this.pubsub.getChannels(pattern);
        return encodeArray(channels);
      }
      case 'SHARDNUMSUB': {
        const channels = subArgs.slice(1);
        const results = this.pubsub.getNumSub(channels);
        const flat: string[] = [];
        for (const [ch, count] of results) {
          flat.push(ch, String(count));
        }
        return encodeArray(flat);
      }
      default:
        return encodeError('unknown subcommand');
    }
  }

  // === Transaction commands ===

  private handleMulti(): string {
    if (this.inMulti) {
      return encodeError('MULTI calls can not be nested');
    }
    this.inMulti = true;
    this.multiQueue = [];
    return encodeSimpleString('OK');
  }

  private async handleExec(): Promise<string> {
    if (!this.inMulti) {
      return encodeError('EXEC without MULTI');
    }
    this.inMulti = false;
    const queue = this.multiQueue;
    this.multiQueue = [];
    const results: string[] = [];
    for (const cmdArgs of queue) {
      let result: string;
      try {
        result = await this.executeDirect(cmdArgs);
      } catch (e: any) {
        result = encodeError(e.message);
      }
      results.push(result);
    }
    return encodeRawArray(results);
  }

  private handleDiscard(): string {
    if (!this.inMulti) {
      return encodeError('DISCARD without MULTI');
    }
    this.inMulti = false;
    this.multiQueue = [];
    return encodeSimpleString('OK');
  }

  /** Execute without transaction queuing logic. Used by EXEC. */
  private async executeDirect(args: string[]): Promise<string> {
    if (args.length === 0) return encodeError('unknown command');
    const command = args[0].toUpperCase();
    try {
      switch (command) {
        case 'PING': return this.ping(args.slice(1));
        case 'SET': return await this.handleSet(args.slice(1));
        case 'GET': return await this.handleGet(args.slice(1));
        case 'DEL': return await this.handleDel(args.slice(1));
        case 'KEYS': return await this.handleKeys(args.slice(1));
        case 'EXISTS': return await this.handleExists(args.slice(1));
        case 'FLUSHDB': return await this.handleFlushdb();
        case 'FLUSHALL': return await this.handleFlushdb();
        case 'COMMAND': return this.handleCommand(args.slice(1));
        case 'MGET': return await this.handleMget(args.slice(1));
        case 'MSET': return await this.handleMset(args.slice(1));
        case 'MSETNX': return await this.handleMsetnx(args.slice(1));
        case 'APPEND': return await this.handleAppend(args.slice(1));
        case 'STRLEN': return await this.handleStrlen(args.slice(1));
        case 'GETRANGE': return await this.handleGetrange(args.slice(1));
        case 'SETRANGE': return await this.handleSetrange(args.slice(1));
        case 'INCR': return await this.handleIncr(args.slice(1));
        case 'DECR': return await this.handleDecr(args.slice(1));
        case 'INCRBY': return await this.handleIncrby(args.slice(1));
        case 'DECRBY': return await this.handleDecrby(args.slice(1));
        case 'INCRBYFLOAT': return await this.handleIncrbyfloat(args.slice(1));
        case 'SETNX': return await this.handleSetnx(args.slice(1));
        case 'SETEX': return await this.handleSetex(args.slice(1));
        case 'PSETEX': return await this.handlePsetex(args.slice(1));
        case 'GETSET': return await this.handleGetset(args.slice(1));
        case 'GETDEL': return await this.handleGetdel(args.slice(1));
        case 'GETEX': return await this.handleGetex(args.slice(1));
        case 'RENAME': return await this.handleRename(args.slice(1));
        case 'RENAMENX': return await this.handleRenamenx(args.slice(1));
        case 'TYPE': return await this.handleType(args.slice(1));
        case 'DBSIZE': return await this.handleDbsize();
        case 'COPY': return await this.handleCopy(args.slice(1));
        case 'RANDOMKEY': return await this.handleRandomkey();
        case 'UNLINK': return await this.handleUnlink(args.slice(1));
        case 'TOUCH': return await this.handleTouch(args.slice(1));
        case 'SCAN': return await this.handleScan(args.slice(1));
        case 'EXPIRE': return await this.handleExpire(args.slice(1));
        case 'EXPIREAT': return await this.handleExpireat(args.slice(1));
        case 'PEXPIRE': return await this.handlePexpire(args.slice(1));
        case 'PEXPIREAT': return await this.handlePexpireat(args.slice(1));
        case 'TTL': return await this.handleTtl(args.slice(1));
        case 'PTTL': return await this.handlePttl(args.slice(1));
        case 'PERSIST': return await this.handlePersist(args.slice(1));
        case 'EXPIRETIME': return await this.handleExpiretime(args.slice(1));
        case 'PEXPIRETIME': return await this.handlePexpiretime(args.slice(1));
        case 'ECHO': return this.handleEcho(args.slice(1));
        case 'QUIT': return this.handleQuit();
        case 'LCS': return await this.handleLcs(args.slice(1));
        case 'SUBSCRIBE': return this.handleSubscribe(args.slice(1));
        case 'UNSUBSCRIBE': return this.handleUnsubscribe(args.slice(1));
        case 'PSUBSCRIBE': return this.handlePsubscribe(args.slice(1));
        case 'PUNSUBSCRIBE': return this.handlePunsubscribe(args.slice(1));
        case 'PUBLISH': return await this.handlePublish(args.slice(1));
        case 'SPUBLISH': return await this.handleSpublish(args.slice(1));
        case 'SSUBSCRIBE': return this.handleSsubscribe(args.slice(1));
        case 'SUNSUBSCRIBE': return this.handleSunsubscribe(args.slice(1));
        case 'PUBSUB': return this.handlePubsub(args.slice(1));
        case 'MULTI': return encodeError('MULTI calls can not be nested');
        case 'EXEC': return encodeError('EXEC without MULTI');
        case 'DISCARD': return encodeError('DISCARD without MULTI');
        case 'INFO': return await this.handleInfo(args.slice(1));
        case 'TIME': return this.handleTime();
        case 'LASTSAVE': return await this.handleLastsave();
        case 'SAVE': return await this.handleSave();
        case 'SHUTDOWN': return this.handleShutdown();
        case 'CONFIG': return this.handleConfig(args.slice(1));
        case 'SLOWLOG': return this.handleSlowlog(args.slice(1));
        case 'MEMORY': return await this.handleMemory(args.slice(1));
        case 'HSET': return await this.handleHset(args.slice(1));
        case 'HGET': return await this.handleHget(args.slice(1));
        case 'HDEL': return await this.handleHdel(args.slice(1));
        case 'HGETALL': return await this.handleHgetall(args.slice(1));
        case 'HKEYS': return await this.handleHkeys(args.slice(1));
        case 'HVALS': return await this.handleHvals(args.slice(1));
        case 'HLEN': return await this.handleHlen(args.slice(1));
        case 'HEXISTS': return await this.handleHexists(args.slice(1));
        case 'HSETNX': return await this.handleHsetnx(args.slice(1));
        case 'HMSET': return await this.handleHmset(args.slice(1));
        case 'HMGET': return await this.handleHmget(args.slice(1));
        case 'HINCRBY': return await this.handleHincrby(args.slice(1));
        case 'HINCRBYFLOAT': return await this.handleHincrbyfloat(args.slice(1));
        case 'HRANDFIELD': return await this.handleHrandfield(args.slice(1));
        case 'HSCAN': return await this.handleHscan(args.slice(1));
        case 'HSTRLEN': return await this.handleHstrlen(args.slice(1));
        case 'HGETDEL': return await this.handleHgetdel(args.slice(1));
        case 'HGETEX': return await this.handleHgetex(args.slice(1));
        case 'HSETEX': return await this.handleHsetex(args.slice(1));
        case 'HEXPIRE': return await this.handleHexpire(args.slice(1));
        case 'HEXPIREAT': return await this.handleHexpireat(args.slice(1));
        case 'HPEXPIRE': return await this.handleHpexpire(args.slice(1));
        case 'HPEXPIREAT': return await this.handleHpexpireat(args.slice(1));
        case 'HEXPIRETIME': return await this.handleHexpiretime(args.slice(1));
        case 'HPEXPIRETIME': return await this.handleHpexpiretime(args.slice(1));
        case 'HPERSIST': return await this.handleHpersist(args.slice(1));
        case 'HTTL': return await this.handleHttl(args.slice(1));
        case 'HPTTL': return await this.handleHpttl(args.slice(1));
        case 'LPUSH': return await this.handleLpush(args.slice(1));
        case 'RPUSH': return await this.handleRpush(args.slice(1));
        case 'LPOP': return await this.handleLpop(args.slice(1));
        case 'RPOP': return await this.handleRpop(args.slice(1));
        case 'LLEN': return await this.handleLlen(args.slice(1));
        case 'LRANGE': return await this.handleLrange(args.slice(1));
        case 'LINDEX': return await this.handleLindex(args.slice(1));
        case 'LSET': return await this.handleLset(args.slice(1));
        case 'LREM': return await this.handleLrem(args.slice(1));
        case 'LTRIM': return await this.handleLtrim(args.slice(1));
        case 'LPOS': return await this.handleLpos(args.slice(1));
        case 'RPOPLPUSH': return await this.handleRpoplpush(args.slice(1));
        case 'LPUSHX': return await this.handleLpushx(args.slice(1));
        case 'RPUSHX': return await this.handleRpushx(args.slice(1));
        case 'LINSERT': return await this.handleLinsert(args.slice(1));
        case 'LMOVE': return await this.handleLmove(args.slice(1));
        case 'BLPOP': return await this.handleBlpop(args.slice(1));
        case 'BRPOP': return await this.handleBrpop(args.slice(1));
        case 'BRPOPLPUSH': return await this.handleBrpoplpush(args.slice(1));
        case 'BLMOVE': return await this.handleBlmove(args.slice(1));
        case 'LMPOP': return await this.handleLmpop(args.slice(1));
        case 'SADD': return await this.handleSadd(args.slice(1));
        case 'SREM': return await this.handleSrem(args.slice(1));
        case 'SMEMBERS': return await this.handleSmembers(args.slice(1));
        case 'SCARD': return await this.handleScard(args.slice(1));
        case 'SISMEMBER': return await this.handleSismember(args.slice(1));
        case 'SMISMEMBER': return await this.handleSmismember(args.slice(1));
        case 'SRANDMEMBER': return await this.handleSrandmember(args.slice(1));
        case 'SPOP': return await this.handleSpop(args.slice(1));
        case 'SMOVE': return await this.handleSmove(args.slice(1));
        case 'SDIFF': return await this.handleSdiff(args.slice(1));
        case 'SINTER': return await this.handleSinter(args.slice(1));
        case 'SUNION': return await this.handleSunion(args.slice(1));
        case 'SDIFFSTORE': return await this.handleSdiffstore(args.slice(1));
        case 'SINTERSTORE': return await this.handleSinterstore(args.slice(1));
        case 'SUNIONSTORE': return await this.handleSunionstore(args.slice(1));
        case 'SINTERCARD': return await this.handleSintercard(args.slice(1));
        case 'SSCAN': return await this.handleSscan(args.slice(1));
        case 'ZADD': return await this.handleZadd(args.slice(1));
        case 'ZREM': return await this.handleZrem(args.slice(1));
        case 'ZSCORE': return await this.handleZscore(args.slice(1));
        case 'ZCARD': return await this.handleZcard(args.slice(1));
        case 'ZRANGE': return await this.handleZrange(args.slice(1));
        case 'ZREVRANGE': return await this.handleZrevrange(args.slice(1));
        case 'ZRANGEBYSCORE': return await this.handleZrangebyscore(args.slice(1));
        case 'ZREVRANGEBYSCORE': return await this.handleZrevrangebyscore(args.slice(1));
        case 'ZRANGEBYLEX': return await this.handleZrangebylex(args.slice(1));
        case 'ZREVRANGEBYLEX': return await this.handleZrevrangebylex(args.slice(1));
        case 'ZRANK': return await this.handleZrank(args.slice(1));
        case 'ZREVRANK': return await this.handleZrevrank(args.slice(1));
        case 'ZINCRBY': return await this.handleZincrby(args.slice(1));
        case 'ZCOUNT': return await this.handleZcount(args.slice(1));
        case 'ZREMRANGEBYRANK': return await this.handleZremrangebyrank(args.slice(1));
        case 'ZREMRANGEBYSCORE': return await this.handleZremrangebyscore(args.slice(1));
        case 'ZREMRANGEBYLEX': return await this.handleZremrangebylex(args.slice(1));
        case 'ZLEXCOUNT': return await this.handleZlexcount(args.slice(1));
        case 'ZSCAN': return await this.handleZscan(args.slice(1));
        case 'ZPOPMAX': return await this.handleZpopmax(args.slice(1));
        case 'ZPOPMIN': return await this.handleZpopmin(args.slice(1));
        case 'ZRANDMEMBER': return await this.handleZrandmember(args.slice(1));
        case 'ZMSCORE': return await this.handleZmscore(args.slice(1));
        case 'ZRANGESTORE': return await this.handleZrangestore(args.slice(1));
        case 'ZDIFF': return await this.handleZdiff(args.slice(1));
        case 'ZDIFFSTORE': return await this.handleZdiffstore(args.slice(1));
        case 'ZUNION': return await this.handleZunion(args.slice(1));
        case 'ZUNIONSTORE': return await this.handleZunionstore(args.slice(1));
        case 'ZINTER': return await this.handleZinter(args.slice(1));
        case 'ZINTERSTORE': return await this.handleZinterstore(args.slice(1));
        case 'ZINTERCARD': return await this.handleZintercard(args.slice(1));
        case 'BZPOPMAX': return await this.handleBzpopmax(args.slice(1));
        case 'BZPOPMIN': return await this.handleBzpopmin(args.slice(1));
        case 'BZMPOP': return await this.handleBzmpop(args.slice(1));
        case 'ZMPOP': return await this.handleZmpop(args.slice(1));

        // Bitmap operations
        case 'SETBIT': return await this.handleSetbit(args.slice(1));
        case 'GETBIT': return await this.handleGetbit(args.slice(1));
        case 'BITCOUNT': return await this.handleBitcount(args.slice(1));
        case 'BITPOS': return await this.handleBitpos(args.slice(1));
        case 'BITOP': return await this.handleBitop(args.slice(1));
        case 'BITFIELD': return await this.handleBitfield(args.slice(1));
        case 'BITFIELD_RO': return await this.handleBitfieldRo(args.slice(1));

        // HyperLogLog operations
        case 'PFADD': return await this.handlePfadd(args.slice(1));
        case 'PFCOUNT': return await this.handlePfcount(args.slice(1));
        case 'PFMERGE': return await this.handlePfmerge(args.slice(1));

        // JSON operations
        case 'JSON.SET': return await this.handleJsonSet(args.slice(1));
        case 'JSON.GET': return await this.handleJsonGet(args.slice(1));
        case 'JSON.DEL': return await this.handleJsonDel(args.slice(1));
        case 'JSON.FORGET': return await this.handleJsonForget(args.slice(1));
        case 'JSON.TYPE': return await this.handleJsonType(args.slice(1));
        case 'JSON.STRLEN': return await this.handleJsonStrlen(args.slice(1));
        case 'JSON.STRAPPEND': return await this.handleJsonStrappend(args.slice(1));
        case 'JSON.OBJKEYS': return await this.handleJsonObjkeys(args.slice(1));
        case 'JSON.OBJLEN': return await this.handleJsonObjlen(args.slice(1));
        case 'JSON.ARRAPPEND': return await this.handleJsonArrappend(args.slice(1));
        case 'JSON.ARRINDEX': return await this.handleJsonArrindex(args.slice(1));
        case 'JSON.ARRINSERT': return await this.handleJsonArrinsert(args.slice(1));
        case 'JSON.ARRLEN': return await this.handleJsonArrlen(args.slice(1));
        case 'JSON.ARRPOP': return await this.handleJsonArrpop(args.slice(1));
        case 'JSON.ARRTRIM': return await this.handleJsonArrtrim(args.slice(1));
        case 'JSON.NUMINCRBY': return await this.handleJsonNumincrby(args.slice(1));
        case 'JSON.NUMMULTBY': return await this.handleJsonNummultby(args.slice(1));
        case 'JSON.MGET': return await this.handleJsonMget(args.slice(1));
        case 'JSON.MSET': return await this.handleJsonMset(args.slice(1));
        case 'JSON.TOGGLE': return await this.handleJsonToggle(args.slice(1));
        case 'JSON.CLEAR': return await this.handleJsonClear(args.slice(1));
        case 'JSON.DEBUG': return await this.handleJsonDebug(args.slice(1));
        case 'JSON.RESP': return await this.handleJsonResp(args.slice(1));
        case 'JSON.MERGE': return await this.handleJsonMerge(args.slice(1));

        // GEO operations
        case 'GEOADD': return await this.handleGeoadd(args.slice(1));
        case 'GEOHASH': return await this.handleGeohash(args.slice(1));
        case 'GEOPOS': return await this.handleGeopos(args.slice(1));
        case 'GEODIST': return await this.handleGeodist(args.slice(1));
        case 'GEORADIUS': return await this.handleGeoradius(args.slice(1));
        case 'GEORADIUSBYMEMBER': return await this.handleGeoradiusbymember(args.slice(1));
        case 'GEOSEARCH': return await this.handleGeosearch(args.slice(1));
        case 'GEOSEARCHSTORE': return await this.handleGeosearchstore(args.slice(1));
        case 'GEORADIUS_RO': return await this.handleGeoradiusRo(args.slice(1));
        case 'GEORADIUSBYMEMBER_RO': return await this.handleGeoradiusbymemberRo(args.slice(1));

        // Stream operations
        case 'XADD': return await this.handleXadd(args.slice(1));
        case 'XTRIM': return await this.handleXtrim(args.slice(1));
        case 'XDEL': return await this.handleXdel(args.slice(1));
        case 'XRANGE': return await this.handleXrange(args.slice(1));
        case 'XREVRANGE': return await this.handleXrevrange(args.slice(1));
        case 'XLEN': return await this.handleXlen(args.slice(1));
        case 'XREAD': return await this.handleXread(args.slice(1));
        case 'XGROUP': return await this.handleXgroup(args.slice(1));
        case 'XREADGROUP': return await this.handleXreadgroup(args.slice(1));
        case 'XACK': return await this.handleXack(args.slice(1));
        case 'XPENDING': return await this.handleXpending(args.slice(1));
        case 'XCLAIM': return await this.handleXclaim(args.slice(1));
        case 'XAUTOCLAIM': return await this.handleXautoclaim(args.slice(1));
        case 'XINFO': return await this.handleXinfo(args.slice(1));
        case 'XSETID': return await this.handleXsetid(args.slice(1));
        case 'SORT': return await this.handleSort(args.slice(1));
        case 'SORT_RO': return await this.handleSortRo(args.slice(1));

        default: return encodeError(`unknown command '${args[0]}'`);
      }
    } catch (e: any) {
      if (e.message.startsWith('WRONGTYPE')) {
        return `-${e.message}\r\n`;
      }
      return encodeError(e.message);
    }
  }

  // === Server commands ===

  private async handleInfo(args: string[]): Promise<string> {
    const section = args.length > 0 ? args[0] : undefined;
    const info = await this.storage.info(section);
    return encodeBulkString(info);
  }

  private handleTime(): string {
    const now = new Date();
    const unixSec = Math.floor(now.getTime() / 1000).toString();
    const microSec = (now.getMilliseconds() * 1000).toString();
    return `*2\r\n${encodeBulkString(unixSec)}${encodeBulkString(microSec)}`;
  }

  private async handleLastsave(): Promise<string> {
    const lastSave = await this.storage.getLastSaveTime();
    return encodeInteger(lastSave);
  }

  private async handleSave(): Promise<string> {
    await this.storage.save();
    return encodeSimpleString('OK');
  }

  private handleShutdown(): string {
    return encodeSimpleString('OK');
  }

  private handleConfig(args: string[]): string {
    if (args.length === 0) return encodeArray(null);
    const sub = args[0].toUpperCase();
    switch (sub) {
      case 'GET': {
        if (args.length < 2) return encodeArray(null);
        const param = args[1].toLowerCase();
        switch (param) {
          case 'save': return `*2\r\n${encodeBulkString('save')}${encodeBulkString('60 1000')}`;
          case 'appendonly': return `*2\r\n${encodeBulkString('appendonly')}${encodeBulkString('no')}`;
          case 'dbfilename': return `*2\r\n${encodeBulkString('dbfilename')}${encodeBulkString('dump.rdb')}`;
          case 'dir': return `*2\r\n${encodeBulkString('dir')}${encodeBulkString('./')}`;
          default: return encodeArray([]);
        }
      }
      case 'SET': {
        if (args.length < 3) return encodeError('wrong number of arguments for \'CONFIG SET\' command');
        const param = args[1].toLowerCase();
        switch (param) {
          case 'save': return encodeError('CONFIG SET failed');
          case 'appendonly': case 'dbfilename': return encodeSimpleString('OK');
          default: return encodeSimpleString('OK');
        }
      }
      default:
        return encodeError('unknown subcommand');
    }
  }

  private handleSlowlog(args: string[]): string {
    if (args.length === 0) return encodeArray(null);
    const sub = args[0].toUpperCase();
    switch (sub) {
      case 'GET': {
        let count = 10;
        if (args.length >= 2) {
          const c = parseInt(args[1]);
          if (!isNaN(c)) count = c;
        }
        const entries = slowLog.slice(-count);
        const results: string[] = entries.map(e =>
          encodeRawArray([encodeInteger(e.timestamp), encodeInteger(e.duration), encodeArray(e.command)])
        );
        return encodeRawArray(results);
      }
      case 'LEN': return encodeInteger(slowLog.length);
      case 'RESET': {
        slowLog.length = 0;
        return encodeSimpleString('OK');
      }
      default: return encodeError('unknown subcommand');
    }
  }

  private async handleMemory(args: string[]): Promise<string> {
    if (args.length === 0) return encodeError('wrong number of arguments for \'MEMORY\' command');
    const sub = args[0].toUpperCase();
    switch (sub) {
      case 'USAGE': {
        if (args.length < 2) return encodeError('wrong number of arguments for \'memory|usage\' command');
        const key = args[1];
        const value = await this.storage.get(key);
        if (value === null) return encodeInteger(-1);
        // Estimate: value length + 64 bytes overhead
        return encodeInteger(value.length + 64);
      }
      default:
        return encodeError('unknown subcommand');
    }
  }

  // === Multi-key ===

  private async handleMget(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError("wrong number of arguments for 'MGET' command");
    }
    const results = await this.storage.mget(args);
    const parts = results.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleMset(args: string[]): Promise<string> {
    if (args.length < 2 || args.length % 2 !== 0) {
      return encodeError("wrong number of arguments for 'MSET' command");
    }
    const pairs: Array<{ key: string; value: string }> = [];
    for (let i = 0; i < args.length; i += 2) {
      pairs.push({ key: args[i], value: args[i + 1] });
    }
    await this.storage.mset(pairs);
    return encodeSimpleString('OK');
  }

  private async handleMsetnx(args: string[]): Promise<string> {
    if (args.length < 2 || args.length % 2 !== 0) {
      return encodeError("wrong number of arguments for 'MSETNX' command");
    }
    const pairs: Array<{ key: string; value: string }> = [];
    for (let i = 0; i < args.length; i += 2) {
      pairs.push({ key: args[i], value: args[i + 1] });
    }
    const result = await this.storage.msetnx(pairs);
    return encodeInteger(result ? 1 : 0);
  }

  // === String operations ===

  private async handleAppend(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'APPEND' command");
    }
    const result = await this.storage.append(args[0], args[1]);
    return encodeInteger(result);
  }

  private async handleStrlen(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'STRLEN' command");
    }
    const result = await this.storage.strlen(args[0]);
    return encodeInteger(result);
  }

  private async handleGetrange(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'GETRANGE' command");
    }
    const start = parseInt(args[1]);
    const end = parseInt(args[2]);
    if (isNaN(start) || isNaN(end)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.getrange(args[0], start, end);
    return encodeBulkString(result);
  }

  private async handleSetrange(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'SETRANGE' command");
    }
    const offset = parseInt(args[1]);
    if (isNaN(offset)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.setrange(args[0], offset, args[2]);
    return encodeInteger(result);
  }

  private async handleIncr(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'INCR' command");
    }
    const result = await this.storage.incrby(args[0], 1);
    return encodeInteger(result);
  }

  private async handleDecr(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'DECR' command");
    }
    const result = await this.storage.incrby(args[0], -1);
    return encodeInteger(result);
  }

  private async handleIncrby(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'INCRBY' command");
    }
    const delta = parseInt(args[1]);
    if (isNaN(delta)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.incrby(args[0], delta);
    return encodeInteger(result);
  }

  private async handleDecrby(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'DECRBY' command");
    }
    const delta = parseInt(args[1]);
    if (isNaN(delta)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.incrby(args[0], -delta);
    return encodeInteger(result);
  }

  private async handleIncrbyfloat(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'INCRBYFLOAT' command");
    }
    const delta = parseFloat(args[1]);
    if (isNaN(delta)) {
      return encodeError('ERR value is not a valid float');
    }
    const result = await this.storage.incrbyfloat(args[0], delta);
    return encodeBulkString(result);
  }

  // === Conditional set ===

  private async handleSetnx(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'SETNX' command");
    }
    const result = await this.storage.setnx(args[0], args[1]);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleSetex(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'SETEX' command");
    }
    const seconds = parseInt(args[1]);
    if (isNaN(seconds) || seconds <= 0) {
      return encodeError('ERR invalid expire time in setex');
    }
    await this.storage.setex(args[0], seconds, args[2]);
    return encodeSimpleString('OK');
  }

  private async handlePsetex(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'PSETEX' command");
    }
    const ms = parseInt(args[1]);
    if (isNaN(ms) || ms <= 0) {
      return encodeError('ERR invalid expire time in psetex');
    }
    await this.storage.psetex(args[0], ms, args[2]);
    return encodeSimpleString('OK');
  }

  private async handleGetset(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'GETSET' command");
    }
    const result = await this.storage.getset(args[0], args[1]);
    return encodeBulkString(result);
  }

  private async handleGetdel(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'GETDEL' command");
    }
    const result = await this.storage.getdel(args[0]);
    return encodeBulkString(result);
  }

  private async handleGetex(args: string[]): Promise<string> {
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
        case 'PERSIST': options.persist = true; break;
        default: return encodeError('ERR syntax error');
      }
    }

    const result = await this.storage.getex(key, options);
    return encodeBulkString(result);
  }

  // === Key management ===

  private async handleRename(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'RENAME' command");
    }
    try {
      await this.storage.rename(args[0], args[1]);
      return encodeSimpleString('OK');
    } catch (e: any) {
      return encodeError(e.message);
    }
  }

  private async handleRenamenx(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'RENAMENX' command");
    }
    try {
      const result = await this.storage.renamenx(args[0], args[1]);
      return encodeInteger(result ? 1 : 0);
    } catch (e: any) {
      return encodeError(e.message);
    }
  }

  private async handleType(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'TYPE' command");
    }
    const result = await this.storage.type(args[0]);
    return encodeSimpleString(result);
  }

  private async handleDbsize(): Promise<string> {
    const result = await this.storage.dbsize();
    return encodeInteger(result);
  }

  private async handleCopy(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'COPY' command");
    }
    const result = await this.storage.copy(args[0], args[1]);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleRandomkey(): Promise<string> {
    const result = await this.storage.randomkey();
    return encodeBulkString(result);
  }

  private async handleUnlink(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError("wrong number of arguments for 'UNLINK' command");
    }
    const result = await this.storage.unlink(args);
    return encodeInteger(result);
  }

  private async handleTouch(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError("wrong number of arguments for 'TOUCH' command");
    }
    const result = await this.storage.touch(args);
    return encodeInteger(result);
  }

  private async handleScan(args: string[]): Promise<string> {
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
    const result = await this.storage.scan(cursor, pattern, count);
    const cursorStr = encodeBulkString(String(result.cursor));
    const keysArr = encodeArray(result.keys);
    return `*2\r\n${cursorStr}${keysArr}`;
  }

  // === Expiry ===

  private async handleExpire(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'EXPIRE' command");
    }
    const seconds = parseInt(args[1]);
    if (isNaN(seconds)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.expire(args[0], seconds);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleExpireat(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'EXPIREAT' command");
    }
    const timestamp = parseInt(args[1]);
    if (isNaN(timestamp)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.expireat(args[0], timestamp);
    return encodeInteger(result ? 1 : 0);
  }

  private async handlePexpire(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'PEXPIRE' command");
    }
    const ms = parseInt(args[1]);
    if (isNaN(ms)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.pexpire(args[0], ms);
    return encodeInteger(result ? 1 : 0);
  }

  private async handlePexpireat(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'PEXPIREAT' command");
    }
    const msTimestamp = parseInt(args[1]);
    if (isNaN(msTimestamp)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.pexpireat(args[0], msTimestamp);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleTtl(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'TTL' command");
    }
    const result = await this.storage.ttl(args[0]);
    return encodeInteger(result);
  }

  private async handlePttl(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'PTTL' command");
    }
    const result = await this.storage.pttl(args[0]);
    return encodeInteger(result);
  }

  private async handlePersist(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'PERSIST' command");
    }
    const result = await this.storage.persist(args[0]);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleExpiretime(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'EXPIRETIME' command");
    }
    const result = await this.storage.expiretime(args[0]);
    return encodeInteger(result);
  }

  private async handlePexpiretime(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'PEXPIRETIME' command");
    }
    const result = await this.storage.pexpiretime(args[0]);
    return encodeInteger(result);
  }

  // === LCS ===

  private async handleLcs(args: string[]): Promise<string> {
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
        case 'LEN': lenOnly = true; break;
        case 'IDX': idx = true; break;
        case 'MINMATCHLEN': {
          i++;
          if (i >= args.length) return encodeError('ERR syntax error');
          minmatchlen = parseInt(args[i]);
          if (isNaN(minmatchlen)) return encodeError('ERR value is not an integer or out of range');
          break;
        }
        case 'WITHMATCHLEN': withmatchlen = true; break;
        default:
          return encodeError('ERR syntax error');
      }
    }

    const s1 = (await this.storage.get(key1)) ?? '';
    const s2 = (await this.storage.get(key2)) ?? '';
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

      const matchesArr = matchArrays.length === 0
        ? '*0\r\n'
        : `*${matchArrays.length}\r\n${matchArrays.join('')}`;

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

  // === Hash operations ===

  private async handleHset(args: string[]): Promise<string> {
    if (args.length < 3 || (args.length - 1) % 2 !== 0) {
      return encodeError("wrong number of arguments for 'HSET' command");
    }
    const key = args[0];
    const pairs: Array<{ field: string; value: string }> = [];
    for (let i = 1; i < args.length; i += 2) {
      pairs.push({ field: args[i], value: args[i + 1] });
    }
    const result = await this.storage.hset(key, pairs);
    return encodeInteger(result);
  }

  private async handleHget(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'HGET' command");
    }
    const result = await this.storage.hget(args[0], args[1]);
    return encodeBulkString(result);
  }

  private async handleHdel(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'HDEL' command");
    }
    const key = args[0];
    const fields = args.slice(1);
    const result = await this.storage.hdel(key, fields);
    return encodeInteger(result);
  }

  private async handleHgetall(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'HGETALL' command");
    }
    const result = await this.storage.hgetall(args[0]);
    const items: string[] = [];
    for (const { field, value } of result) {
      items.push(field, value);
    }
    return encodeArray(items);
  }

  private async handleHkeys(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'HKEYS' command");
    }
    const result = await this.storage.hkeys(args[0]);
    return encodeArray(result);
  }

  private async handleHvals(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'HVALS' command");
    }
    const result = await this.storage.hvals(args[0]);
    return encodeArray(result);
  }

  private async handleHlen(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'HLEN' command");
    }
    const result = await this.storage.hlen(args[0]);
    return encodeInteger(result);
  }

  private async handleHexists(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'HEXISTS' command");
    }
    const result = await this.storage.hexists(args[0], args[1]);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleHsetnx(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'HSETNX' command");
    }
    const result = await this.storage.hsetnx(args[0], args[1], args[2]);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleHmset(args: string[]): Promise<string> {
    if (args.length < 3 || (args.length - 1) % 2 !== 0) {
      return encodeError("wrong number of arguments for 'HMSET' command");
    }
    const key = args[0];
    const pairs: Array<{ field: string; value: string }> = [];
    for (let i = 1; i < args.length; i += 2) {
      pairs.push({ field: args[i], value: args[i + 1] });
    }
    await this.storage.hset(key, pairs);
    return encodeSimpleString('OK');
  }

  private async handleHmget(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'HMGET' command");
    }
    const key = args[0];
    const fields = args.slice(1);
    const result = await this.storage.hmget(key, fields);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleHincrby(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'HINCRBY' command");
    }
    const delta = parseInt(args[2]);
    if (isNaN(delta)) {
      return encodeError('value is not an integer or out of range');
    }
    const result = await this.storage.hincrby(args[0], args[1], delta);
    return encodeInteger(result);
  }

  private async handleHincrbyfloat(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'HINCRBYFLOAT' command");
    }
    const delta = parseFloat(args[2]);
    if (isNaN(delta)) {
      return encodeError('value is not a valid float');
    }
    const result = await this.storage.hincrbyfloat(args[0], args[1], delta);
    return encodeBulkString(result);
  }

  private async handleHrandfield(args: string[]): Promise<string> {
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
      const fields = await this.storage.hrandfield(key, 1);
      if (fields.length === 0) return encodeBulkString(null);
      return encodeBulkString(fields[0]);
    }

    const fields = await this.storage.hrandfield(key, count);

    if (!withValues) {
      return encodeArray(fields);
    }

    const values = await this.storage.hmget(key, fields);
    const items: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      items.push(fields[i], values[i] ?? '');
    }
    return encodeArray(items);
  }

  private async handleHscan(args: string[]): Promise<string> {
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
    const result = await this.storage.hscan(cursor, key, pattern, count);
    const cursorStr = encodeBulkString(String(result.cursor));
    const items: string[] = [];
    for (const { field, value } of result.items) {
      items.push(field, value);
    }
    const itemsArr = encodeArray(items);
    return `*2\r\n${cursorStr}${itemsArr}`;
  }

  private async handleHstrlen(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'HSTRLEN' command");
    }
    const result = await this.storage.hstrlen(args[0], args[1]);
    return encodeInteger(result);
  }

  private async handleHgetdel(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'HGETDEL' command");
    }
    const key = args[0];
    const fields = args.slice(1);
    const result = await this.storage.hgetdel(key, fields);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleHgetex(args: string[]): Promise<string> {
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
    const result = await this.storage.hgetex(key, fields, hasOpts ? options : undefined);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleHsetex(args: string[]): Promise<string> {
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
    const result = await this.storage.hsetex(key, pairs, hasOptions ? options : undefined);
    return encodeInteger(result);
  }

  private async handleHexpire(args: string[]): Promise<string> {
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
    const result = await this.storage.hexpire(key, fields, seconds);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  private async handleHexpireat(args: string[]): Promise<string> {
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
    const result = await this.storage.hexpireat(key, fields, timestamp);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  private async handleHpexpire(args: string[]): Promise<string> {
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
    const result = await this.storage.hpexpire(key, fields, milliseconds);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  private async handleHpexpireat(args: string[]): Promise<string> {
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
    const result = await this.storage.hpexpireat(key, fields, msTimestamp);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  private async handleHexpiretime(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'HEXPIRETIME' command");
    }
    const key = args[0];
    const fields = args.slice(1);
    const result = await this.storage.hexpiretime(key, fields);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  private async handleHpexpiretime(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'HPEXPIRETIME' command");
    }
    const key = args[0];
    const fields = args.slice(1);
    const result = await this.storage.hpexpiretime(key, fields);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  private async handleHpersist(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'HPERSIST' command");
    }
    const key = args[0];
    const fields = args.slice(1);
    const result = await this.storage.hpersist(key, fields);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  private async handleHttl(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'HTTL' command");
    }
    const key = args[0];
    const fields = args.slice(1);
    const result = await this.storage.httl(key, fields);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  private async handleHpttl(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'HPTTL' command");
    }
    const key = args[0];
    const fields = args.slice(1);
    const result = await this.storage.hpttl(key, fields);
    return `*${result.length}\r\n${result.map(r => encodeInteger(r)).join('')}`;
  }

  // === List operations ===

  private async handleLpush(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'LPUSH' command");
    }
    const key = args[0];
    const elements = args.slice(1);
    const result = await this.storage.lpush(key, elements);
    return encodeInteger(result);
  }

  private async handleRpush(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'RPUSH' command");
    }
    const key = args[0];
    const elements = args.slice(1);
    const result = await this.storage.rpush(key, elements);
    return encodeInteger(result);
  }

  private async handleLpop(args: string[]): Promise<string> {
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
      const result = await this.storage.lpop(key, count);
      if (result === null) return encodeArray(null);
      return encodeArray(result as string[]);
    }
    const result = await this.storage.lpop(key);
    if (result === null) return encodeBulkString(null);
    return encodeBulkString(result as string);
  }

  private async handleRpop(args: string[]): Promise<string> {
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
      const result = await this.storage.rpop(key, count);
      if (result === null) return encodeArray(null);
      return encodeArray(result as string[]);
    }
    const result = await this.storage.rpop(key);
    if (result === null) return encodeBulkString(null);
    return encodeBulkString(result as string);
  }

  private async handleLlen(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'LLEN' command");
    }
    const result = await this.storage.llen(args[0]);
    return encodeInteger(result);
  }

  private async handleLrange(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'LRANGE' command");
    }
    const start = parseInt(args[1]);
    const stop = parseInt(args[2]);
    if (isNaN(start) || isNaN(stop)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.lrange(args[0], start, stop);
    return encodeArray(result);
  }

  private async handleLindex(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'LINDEX' command");
    }
    const index = parseInt(args[1]);
    if (isNaN(index)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.lindex(args[0], index);
    return encodeBulkString(result);
  }

  private async handleLset(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'LSET' command");
    }
    const index = parseInt(args[1]);
    if (isNaN(index)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    await this.storage.lset(args[0], index, args[2]);
    return encodeSimpleString('OK');
  }

  private async handleLrem(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'LREM' command");
    }
    const count = parseInt(args[1]);
    if (isNaN(count)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.lrem(args[0], count, args[2]);
    return encodeInteger(result);
  }

  private async handleLtrim(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'LTRIM' command");
    }
    const start = parseInt(args[1]);
    const stop = parseInt(args[2]);
    if (isNaN(start) || isNaN(stop)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    await this.storage.ltrim(args[0], start, stop);
    return encodeSimpleString('OK');
  }

  private async handleLpos(args: string[]): Promise<string> {
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

    const result = await this.storage.lpos(key, element, options);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleRpoplpush(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'RPOPLPUSH' command");
    }
    const result = await this.storage.rpoplpush(args[0], args[1]);
    return encodeBulkString(result);
  }

  private async handleLpushx(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'LPUSHX' command");
    }
    const result = await this.storage.lpushx(args[0], args[1]);
    return encodeInteger(result);
  }

  private async handleRpushx(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'RPUSHX' command");
    }
    const result = await this.storage.rpushx(args[0], args[1]);
    return encodeInteger(result);
  }

  private async handleLinsert(args: string[]): Promise<string> {
    if (args.length !== 4) {
      return encodeError("wrong number of arguments for 'LINSERT' command");
    }
    const position = args[1].toUpperCase();
    if (position !== 'BEFORE' && position !== 'AFTER') {
      return encodeError('ERR syntax error');
    }
    const result = await this.storage.linsert(args[0], position as 'BEFORE' | 'AFTER', args[2], args[3]);
    return encodeInteger(result);
  }

  private async handleLmove(args: string[]): Promise<string> {
    if (args.length !== 4) {
      return encodeError("wrong number of arguments for 'LMOVE' command");
    }
    const srcDir = args[2].toUpperCase();
    const destDir = args[3].toUpperCase();
    if ((srcDir !== 'LEFT' && srcDir !== 'RIGHT') || (destDir !== 'LEFT' && destDir !== 'RIGHT')) {
      return encodeError('ERR syntax error');
    }
    const result = await this.storage.lmove(args[0], args[1], srcDir as 'LEFT' | 'RIGHT', destDir as 'LEFT' | 'RIGHT');
    return encodeBulkString(result);
  }

  private async handleBlpop(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'BLPOP' command");
    }
    const timeout = parseFloat(args[args.length - 1]);
    if (isNaN(timeout)) {
      return encodeError('ERR timeout is not a float or out of range');
    }
    const keys = args.slice(0, -1);
    const result = await this.storage.blpop(keys, timeout);
    if (result === null) return encodeArray(null);
    return encodeArray([result.key, result.element]);
  }

  private async handleBrpop(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'BRPOP' command");
    }
    const timeout = parseFloat(args[args.length - 1]);
    if (isNaN(timeout)) {
      return encodeError('ERR timeout is not a float or out of range');
    }
    const keys = args.slice(0, -1);
    const result = await this.storage.brpop(keys, timeout);
    if (result === null) return encodeArray(null);
    return encodeArray([result.key, result.element]);
  }

  private async handleBrpoplpush(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'BRPOPLPUSH' command");
    }
    const timeout = parseFloat(args[2]);
    if (isNaN(timeout)) {
      return encodeError('ERR timeout is not a float or out of range');
    }
    const result = await this.storage.brpoplpush(args[0], args[1], timeout);
    return encodeBulkString(result);
  }

  private async handleBlmove(args: string[]): Promise<string> {
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
    const result = await this.storage.blmove(args[0], args[1], srcDir as 'LEFT' | 'RIGHT', destDir as 'LEFT' | 'RIGHT', timeout);
    return encodeBulkString(result);
  }

  private async handleLmpop(args: string[]): Promise<string> {
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

    const result = await this.storage.lmpop(numkeys, keys, dir, count);
    if (result === null) return encodeArray(null);
    const keyEncoded = encodeBulkString(result.key);
    const elementsEncoded = encodeArray(result.elements);
    return `*2\r\n${keyEncoded}${elementsEncoded}`;
  }

  // === Set operations ===

  private async handleSadd(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'sadd' command");
    }
    const key = args[0];
    const members = args.slice(1);
    const result = await this.storage.sadd(key, members);
    return encodeInteger(result);
  }

  private async handleSrem(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'srem' command");
    }
    const key = args[0];
    const members = args.slice(1);
    const result = await this.storage.srem(key, members);
    return encodeInteger(result);
  }

  private async handleSmembers(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'smembers' command");
    }
    const key = args[0];
    const result = await this.storage.smembers(key);
    return encodeArray(result);
  }

  private async handleScard(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'scard' command");
    }
    const key = args[0];
    const result = await this.storage.scard(key);
    return encodeInteger(result);
  }

  private async handleSismember(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'sismember' command");
    }
    const key = args[0];
    const member = args[1];
    const result = await this.storage.sismember(key, member);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleSmismember(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'smismember' command");
    }
    const key = args[0];
    const members = args.slice(1);
    const results = await this.storage.smismember(key, members);
    const parts = results.map(r => encodeInteger(r ? 1 : 0));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleSrandmember(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'srandmember' command");
    }
    const key = args[0];
    if (args.length >= 2) {
      const count = parseInt(args[1]);
      if (isNaN(count)) {
        return encodeError('ERR value is not an integer or out of range');
      }
      const results = await this.storage.srandmember(key, count);
      return encodeArray(results);
    }
    const results = await this.storage.srandmember(key);
    return encodeBulkString(results[0] ?? null);
  }

  private async handleSpop(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'spop' command");
    }
    const key = args[0];
    if (args.length >= 2) {
      const count = parseInt(args[1]);
      if (isNaN(count)) {
        return encodeError('ERR value is not an integer or out of range');
      }
      const results = await this.storage.spop(key, count);
      if (count === 1) {
        return encodeBulkString(results[0] ?? null);
      }
      return encodeArray(results);
    }
    const results = await this.storage.spop(key);
    if (results.length === 0) return encodeBulkString(null);
    return encodeBulkString(results[0]);
  }

  private async handleSmove(args: string[]): Promise<string> {
    if (args.length < 3) {
      return encodeError("wrong number of arguments for 'smove' command");
    }
    const source = args[0];
    const destination = args[1];
    const member = args[2];
    const result = await this.storage.smove(source, destination, member);
    return encodeInteger(result ? 1 : 0);
  }

  private async handleSdiff(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'sdiff' command");
    }
    const keys = args;
    const result = await this.storage.sdiff(keys);
    return encodeArray(result);
  }

  private async handleSinter(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'sinter' command");
    }
    const keys = args;
    const result = await this.storage.sinter(keys);
    return encodeArray(result);
  }

  private async handleSunion(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'sunion' command");
    }
    const keys = args;
    const result = await this.storage.sunion(keys);
    return encodeArray(result);
  }

  private async handleSdiffstore(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'sdiffstore' command");
    }
    const destination = args[0];
    const keys = args.slice(1);
    const result = await this.storage.sdiffstore(destination, keys);
    return encodeInteger(result);
  }

  private async handleSinterstore(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'sinterstore' command");
    }
    const destination = args[0];
    const keys = args.slice(1);
    const result = await this.storage.sinterstore(destination, keys);
    return encodeInteger(result);
  }

  private async handleSunionstore(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'sunionstore' command");
    }
    const destination = args[0];
    const keys = args.slice(1);
    const result = await this.storage.sunionstore(destination, keys);
    return encodeInteger(result);
  }

  private async handleSintercard(args: string[]): Promise<string> {
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
    const result = await this.storage.sintercard(keys, limit);
    return encodeInteger(result);
  }

  private async handleSscan(args: string[]): Promise<string> {
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
    const result = await this.storage.sscan(key, cursor, pattern, count);
    const cursorStr = encodeBulkString(String(result[0]));
    const membersArr = encodeArray(result[1]);
    return `*2\r\n${cursorStr}${membersArr}`;
  }

  // === Sorted Set operations ===

  private async handleZadd(args: string[]): Promise<string> {
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
    const result = await this.storage.zadd(key, scoreMembers, options);
    if (incr) {
      // Result is string | null
      return encodeBulkString(result as string | null);
    }
    // Result is number
    return encodeInteger(result as number);
  }

  private async handleZrem(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'ZREM' command");
    }
    const key = args[0];
    const members = args.slice(1);
    const result = await this.storage.zrem(key, members);
    return encodeInteger(result);
  }

  private async handleZscore(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'ZSCORE' command");
    }
    const result = await this.storage.zscore(args[0], args[1]);
    return encodeBulkString(result);
  }

  private async handleZcard(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'ZCARD' command");
    }
    const result = await this.storage.zcard(args[0]);
    return encodeInteger(result);
  }

  private async handleZrange(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zrange(key, min, max, options);
    if (withScores) {
      const flat: string[] = [];
      for (const p of pairs) {
        flat.push(p.member, String(p.score));
      }
      return encodeArray(flat);
    }
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZrevrange(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zrange(key, min, max, { rev: true });
    if (withScores) {
      const flat: string[] = [];
      for (const p of pairs) {
        flat.push(p.member, String(p.score));
      }
      return encodeArray(flat);
    }
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZrangebyscore(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zrange(key, min, max, options);
    if (withScores) {
      const flat: string[] = [];
      for (const p of pairs) {
        flat.push(p.member, String(p.score));
      }
      return encodeArray(flat);
    }
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZrevrangebyscore(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zrange(key, max, min, options);
    if (withScores) {
      const flat: string[] = [];
      for (const p of pairs) {
        flat.push(p.member, String(p.score));
      }
      return encodeArray(flat);
    }
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZrangebylex(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zrange(key, min, max, options);
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZrevrangebylex(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zrange(key, max, min, options);
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZrank(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'ZRANK' command");
    }
    const result = await this.storage.zrank(args[0], args[1]);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleZrevrank(args: string[]): Promise<string> {
    if (args.length !== 2) {
      return encodeError("wrong number of arguments for 'ZREVRANK' command");
    }
    const result = await this.storage.zrevrank(args[0], args[1]);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleZincrby(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'ZINCRBY' command");
    }
    const increment = parseFloat(args[1]);
    if (isNaN(increment)) {
      return encodeError('ERR value is not a valid float');
    }
    const result = await this.storage.zincrby(args[0], increment, args[2]);
    return encodeBulkString(result);
  }

  private async handleZcount(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'ZCOUNT' command");
    }
    const result = await this.storage.zcount(args[0], args[1], args[2]);
    return encodeInteger(result);
  }

  private async handleZremrangebyrank(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'ZREMRANGEBYRANK' command");
    }
    const start = parseInt(args[1]);
    const stop = parseInt(args[2]);
    if (isNaN(start) || isNaN(stop)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.zremrangebyrank(args[0], start, stop);
    return encodeInteger(result);
  }

  private async handleZremrangebyscore(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'ZREMRANGEBYSCORE' command");
    }
    const result = await this.storage.zremrangebyscore(args[0], args[1], args[2]);
    return encodeInteger(result);
  }

  private async handleZremrangebylex(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'ZREMRANGEBYLEX' command");
    }
    const result = await this.storage.zremrangebylex(args[0], args[1], args[2]);
    return encodeInteger(result);
  }

  private async handleZlexcount(args: string[]): Promise<string> {
    if (args.length !== 3) {
      return encodeError("wrong number of arguments for 'ZLEXCOUNT' command");
    }
    const result = await this.storage.zlexcount(args[0], args[1], args[2]);
    return encodeInteger(result);
  }

  private async handleZscan(args: string[]): Promise<string> {
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
    const result = await this.storage.zscan(key, cursor, pattern, count);
    const cursorStr = encodeBulkString(String(result[0]));
    const membersArr = encodeArray(result[1]);
    return `*2\r\n${cursorStr}${membersArr}`;
  }

  private async handleZpopmax(args: string[]): Promise<string> {
    if (args.length < 1 || args.length > 2) {
      return encodeError("wrong number of arguments for 'ZPOPMAX' command");
    }
    const key = args[0];
    let count: number | undefined;
    if (args.length === 2) {
      count = parseInt(args[1]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.zpopmax(key, count);
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

  private async handleZpopmin(args: string[]): Promise<string> {
    if (args.length < 1 || args.length > 2) {
      return encodeError("wrong number of arguments for 'ZPOPMIN' command");
    }
    const key = args[0];
    let count: number | undefined;
    if (args.length === 2) {
      count = parseInt(args[1]);
      if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.zpopmin(key, count);
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

  private async handleZrandmember(args: string[]): Promise<string> {
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
    const result = await this.storage.zrandmember(key, count);
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

  private async handleZmscore(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'ZMSCORE' command");
    }
    const key = args[0];
    const members = args.slice(1);
    const results = await this.storage.zmscore(key, members);
    const parts = results.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleZrangestore(args: string[]): Promise<string> {
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
    const result = await this.storage.zrangestore(destination, source, min, max, options);
    return encodeInteger(result);
  }

  private async handleZdiff(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zdiff(keys);
    if (withScores) {
      const flat: string[] = [];
      for (const p of pairs) {
        flat.push(p.member, String(p.score));
      }
      return encodeArray(flat);
    }
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZdiffstore(args: string[]): Promise<string> {
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
    const result = await this.storage.zdiffstore(destination, keys);
    return encodeInteger(result);
  }

  private async handleZunion(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zunion(keys, options);
    if (withScores) {
      const flat: string[] = [];
      for (const p of pairs) {
        flat.push(p.member, String(p.score));
      }
      return encodeArray(flat);
    }
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZunionstore(args: string[]): Promise<string> {
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
    const result = await this.storage.zunionstore(destination, keys, options);
    return encodeInteger(result);
  }

  private async handleZinter(args: string[]): Promise<string> {
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
    const pairs = await this.storage.zinter(keys, options);
    if (withScores) {
      const flat: string[] = [];
      for (const p of pairs) {
        flat.push(p.member, String(p.score));
      }
      return encodeArray(flat);
    }
    return encodeArray(pairs.map(p => p.member));
  }

  private async handleZinterstore(args: string[]): Promise<string> {
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
    const result = await this.storage.zinterstore(destination, keys, options);
    return encodeInteger(result);
  }

  private async handleZintercard(args: string[]): Promise<string> {
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
    const result = await this.storage.zintercard(keys, limit);
    return encodeInteger(result);
  }

  private async handleBzpopmax(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'BZPOPMAX' command");
    }
    const timeout = parseFloat(args[args.length - 1]);
    if (isNaN(timeout)) {
      return encodeError('ERR timeout is not a float or out of range');
    }
    const keys = args.slice(0, -1);
    const result = await this.storage.bzpopmax(keys, timeout);
    if (result === null) return encodeArray(null);
    return encodeArray([result.key, result.member, String(result.score)]);
  }

  private async handleBzpopmin(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'BZPOPMIN' command");
    }
    const timeout = parseFloat(args[args.length - 1]);
    if (isNaN(timeout)) {
      return encodeError('ERR timeout is not a float or out of range');
    }
    const keys = args.slice(0, -1);
    const result = await this.storage.bzpopmin(keys, timeout);
    if (result === null) return encodeArray(null);
    return encodeArray([result.key, result.member, String(result.score)]);
  }

  private async handleBzmpop(args: string[]): Promise<string> {
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
    const result = await this.storage.bzmpop(numkeys, keys, minmax, count);
    if (result === null) return encodeArray(null);
    const keyEncoded = encodeBulkString(result.key);
    const flat: string[] = [];
    for (const e of result.elements) {
      flat.push(e.member, String(e.score));
    }
    const elementsEncoded = encodeArray(flat);
    return `*2\r\n${keyEncoded}${elementsEncoded}`;
  }

  private async handleZmpop(args: string[]): Promise<string> {
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
    const result = await this.storage.zmpop(numkeys, keys, minmax, count);
    if (result === null) return encodeArray(null);
    const keyEncoded = encodeBulkString(result.key);
    const flat: string[] = [];
    for (const e of result.elements) {
      flat.push(e.member, String(e.score));
    }
    const elementsEncoded = encodeArray(flat);
    return `*2\r\n${keyEncoded}${elementsEncoded}`;
  }

  // === Bitmap operations ===

  private async handleSetbit(args: string[]): Promise<string> {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'SETBIT' command");
    const key = args[0];
    const offset = parseInt(args[1]);
    const value = parseInt(args[2]);
    if (isNaN(offset) || offset < 0) return encodeError('ERR bit offset is not an integer or out of range');
    if (value !== 0 && value !== 1) return encodeError('ERR bit is not an integer or out of range');
    const result = await this.storage.setbit(key, offset, value as 0 | 1);
    return encodeInteger(result);
  }

  private async handleGetbit(args: string[]): Promise<string> {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'GETBIT' command");
    const offset = parseInt(args[1]);
    if (isNaN(offset) || offset < 0) return encodeError('ERR bit offset is not an integer or out of range');
    const result = await this.storage.getbit(args[0], offset);
    return encodeInteger(result);
  }

  private async handleBitcount(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'BITCOUNT' command");
    let start: number | undefined;
    let end: number | undefined;
    if (args.length >= 2) {
      start = parseInt(args[1]);
      if (isNaN(start)) return encodeError('ERR value is not an integer or out of range');
    }
    if (args.length >= 3) {
      end = parseInt(args[2]);
      if (isNaN(end)) return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.bitcount(args[0], start, end);
    return encodeInteger(result);
  }

  private async handleBitpos(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'BITPOS' command");
    const bit = parseInt(args[1]);
    if (bit !== 0 && bit !== 1) return encodeError('ERR bit is not an integer or out of range');
    let start: number | undefined;
    let end: number | undefined;
    if (args.length >= 3) {
      start = parseInt(args[2]);
      if (isNaN(start)) return encodeError('ERR value is not an integer or out of range');
    }
    if (args.length >= 4) {
      end = parseInt(args[3]);
      if (isNaN(end)) return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.bitpos(args[0], bit as 0 | 1, start, end);
    return encodeInteger(result);
  }

  private async handleBitop(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'BITOP' command");
    const operation = args[0].toUpperCase() as 'AND' | 'OR' | 'XOR' | 'NOT';
    if (!['AND', 'OR', 'XOR', 'NOT'].includes(operation)) return encodeError('ERR syntax error');
    const destkey = args[1];
    const keys = args.slice(2);
    if (operation === 'NOT' && keys.length !== 1) return encodeError('ERR BITOP NOT requires exactly one source key');
    const result = await this.storage.bitop(operation, destkey, keys);
    return encodeInteger(result);
  }

  private async handleBitfield(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'BITFIELD' command");
    const key = args[0];
    const operations: Array<{ type: 'GET' | 'SET' | 'INCRBY'; encoding: string; offset: number; value?: number; overflow?: 'WRAP' | 'SAT' | 'FAIL' }> = [];
    let currentOverflow: 'WRAP' | 'SAT' | 'FAIL' = 'WRAP';
    let i = 1;
    while (i < args.length) {
      const cmd = args[i].toUpperCase();
      if (cmd === 'OVERFLOW') {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const mode = args[i].toUpperCase();
        if (!['WRAP', 'SAT', 'FAIL'].includes(mode)) return encodeError('ERR syntax error');
        currentOverflow = mode as 'WRAP' | 'SAT' | 'FAIL';
        i++;
        continue;
      }
      if (cmd === 'GET') {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const encoding = args[i].toUpperCase();
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const offset = parseInt(args[i]);
        if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
        operations.push({ type: 'GET', encoding, offset, overflow: currentOverflow });
        i++;
      } else if (cmd === 'SET') {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const encoding = args[i].toUpperCase();
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const offset = parseInt(args[i]);
        if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const value = parseInt(args[i]);
        if (isNaN(value)) return encodeError('ERR value is not an integer or out of range');
        operations.push({ type: 'SET', encoding, offset, value, overflow: currentOverflow });
        i++;
      } else if (cmd === 'INCRBY') {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const encoding = args[i].toUpperCase();
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const offset = parseInt(args[i]);
        if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const increment = parseInt(args[i]);
        if (isNaN(increment)) return encodeError('ERR value is not an integer or out of range');
        operations.push({ type: 'INCRBY', encoding, offset, value: increment, overflow: currentOverflow });
        i++;
      } else {
        return encodeError('ERR syntax error');
      }
    }
    const result = await this.storage.bitfield(key, operations);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeInteger(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleBitfieldRo(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'BITFIELD_RO' command");
    const key = args[0];
    const operations: Array<{ type: 'GET'; encoding: string; offset: number }> = [];
    let i = 1;
    while (i < args.length) {
      const cmd = args[i].toUpperCase();
      if (cmd === 'GET') {
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const encoding = args[i].toUpperCase();
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        const offset = parseInt(args[i]);
        if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
        operations.push({ type: 'GET', encoding, offset });
        i++;
      } else {
        return encodeError('ERR syntax error');
      }
    }
    const result = await this.storage.bitfieldRo(key, operations);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeInteger(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  // === HyperLogLog operations ===

  private async handlePfadd(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'PFADD' command");
    const key = args[0];
    const elements = args.slice(1);
    const result = await this.storage.pfadd(key, elements);
    return encodeInteger(result);
  }

  private async handlePfcount(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'PFCOUNT' command");
    const result = await this.storage.pfcount(args);
    return encodeInteger(result);
  }

  private async handlePfmerge(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'PFMERGE' command");
    const destkey = args[0];
    const sourceKeys = args.slice(1);
    await this.storage.pfmerge(destkey, sourceKeys);
    return encodeSimpleString('OK');
  }

  // === JSON operations ===

  private async handleJsonSet(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.SET' command");
    const key = args[0];
    const path = args[1];
    const value = args[2];
    let nx = false, xx = false;
    for (let i = 3; i < args.length; i++) {
      const opt = args[i].toUpperCase();
      if (opt === 'NX') nx = true;
      else if (opt === 'XX') xx = true;
      else return encodeError('ERR syntax error');
    }
    const result = await this.storage.jsonSet(key, path, value, nx || undefined, xx || undefined);
    if (result === null) return encodeBulkString(null);
    return encodeSimpleString('OK');
  }

  private async handleJsonGet(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.GET' command");
    const key = args[0];
    const paths = args.length > 1 ? args.slice(1) : undefined;
    const result = await this.storage.jsonGet(key, paths);
    return encodeBulkString(result);
  }

  private async handleJsonDel(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.DEL' command");
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonDel(args[0], path);
    return encodeInteger(result);
  }

  private async handleJsonForget(args: string[]): Promise<string> {
    return this.handleJsonDel(args);
  }

  private async handleJsonType(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.TYPE' command");
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonType(args[0], path);
    if (result === null) return encodeBulkString(null);
    return encodeSimpleString(result);
  }

  private async handleJsonStrlen(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.STRLEN' command");
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonStrlen(args[0], path);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleJsonStrappend(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.STRAPPEND' command");
    const key = args[0];
    const path = args[1];
    const value = args[2];
    const result = await this.storage.jsonStrappend(key, path, value);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleJsonObjkeys(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.OBJKEYS' command");
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonObjkeys(args[0], path);
    if (result === null) return encodeArray(null);
    return encodeArray(result);
  }

  private async handleJsonObjlen(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.OBJLEN' command");
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonObjlen(args[0], path);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleJsonArrappend(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.ARRAPPEND' command");
    const key = args[0];
    const path = args[1];
    const values = args.slice(2);
    const result = await this.storage.jsonArrappend(key, path, values);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeInteger(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleJsonArrindex(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.ARRINDEX' command");
    const key = args[0];
    const path = args[1];
    const value = args[2];
    let start: number | undefined;
    let stop: number | undefined;
    if (args.length >= 4) { start = parseInt(args[3]); if (isNaN(start)) return encodeError('ERR value is not an integer or out of range'); }
    if (args.length >= 5) { stop = parseInt(args[4]); if (isNaN(stop)) return encodeError('ERR value is not an integer or out of range'); }
    const result = await this.storage.jsonArrindex(key, path, value, start, stop);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleJsonArrinsert(args: string[]): Promise<string> {
    if (args.length < 4) return encodeError("wrong number of arguments for 'JSON.ARRINSERT' command");
    const key = args[0];
    const path = args[1];
    const index = parseInt(args[2]);
    if (isNaN(index)) return encodeError('ERR value is not an integer or out of range');
    const values = args.slice(3);
    const result = await this.storage.jsonArrinsert(key, path, index, values);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeInteger(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleJsonArrlen(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.ARRLEN' command");
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonArrlen(args[0], path);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleJsonArrpop(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.ARRPOP' command");
    const key = args[0];
    let path: string | undefined;
    let index: number | undefined;
    if (args.length >= 2) path = args[1];
    if (args.length >= 3) {
      index = parseInt(args[2]);
      if (isNaN(index)) return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.jsonArrpop(key, path, index);
    return encodeBulkString(result);
  }

  private async handleJsonArrtrim(args: string[]): Promise<string> {
    if (args.length < 4) return encodeError("wrong number of arguments for 'JSON.ARRTRIM' command");
    const key = args[0];
    const path = args[1];
    const start = parseInt(args[2]);
    const stop = parseInt(args[3]);
    if (isNaN(start) || isNaN(stop)) return encodeError('ERR value is not an integer or out of range');
    const result = await this.storage.jsonArrtrim(key, path, start, stop);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleJsonNumincrby(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.NUMINCRBY' command");
    const key = args[0];
    const path = args[1];
    const increment = parseFloat(args[2]);
    if (isNaN(increment)) return encodeError('ERR value is not a valid float');
    const result = await this.storage.jsonNumincrby(key, path, increment);
    return encodeBulkString(result);
  }

  private async handleJsonNummultby(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.NUMMULTBY' command");
    const key = args[0];
    const path = args[1];
    const multiplier = parseFloat(args[2]);
    if (isNaN(multiplier)) return encodeError('ERR value is not a valid float');
    const result = await this.storage.jsonNummultby(key, path, multiplier);
    return encodeBulkString(result);
  }

  private async handleJsonMget(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'JSON.MGET' command");
    const path = args[args.length - 1];
    const keys = args.slice(0, args.length - 1);
    const result = await this.storage.jsonMget(keys, path);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleJsonMset(args: string[]): Promise<string> {
    if (args.length < 3 || args.length % 3 !== 0) return encodeError("wrong number of arguments for 'JSON.MSET' command");
    const pairs: Array<{ key: string; path: string; value: string }> = [];
    for (let i = 0; i < args.length; i += 3) {
      pairs.push({ key: args[i], path: args[i + 1], value: args[i + 2] });
    }
    await this.storage.jsonMset(pairs);
    return encodeSimpleString('OK');
  }

  private async handleJsonToggle(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.TOGGLE' command");
    const key = args[0];
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonToggle(key, path);
    return encodeBulkString(result);
  }

  private async handleJsonClear(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.CLEAR' command");
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonClear(args[0], path);
    return encodeInteger(result);
  }

  private async handleJsonDebug(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.DEBUG' command");
    const subcmd = args[0].toUpperCase();
    if (subcmd !== 'MEMORY') return encodeError('unknown subcommand');
    if (args.length < 2) return encodeError("wrong number of arguments for 'JSON.DEBUG MEMORY' command");
    const key = args[1];
    const path = args.length > 2 ? args[2] : undefined;
    const result = await this.storage.jsonDebugMemory(key, path);
    if (result === null) return encodeBulkString(null);
    return encodeInteger(result);
  }

  private async handleJsonResp(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.RESP' command");
    const key = args[0];
    const path = args.length > 1 ? args[1] : undefined;
    const result = await this.storage.jsonResp(key, path);
    return result ?? encodeBulkString(null);
  }

  private async handleJsonMerge(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.MERGE' command");
    const key = args[0];
    const path = args[1];
    const value = args[2];
    await this.storage.jsonMerge(key, path, value);
    return encodeSimpleString('OK');
  }

  // === GEO operations ===

  private async handleGeoadd(args: string[]): Promise<string> {
    if (args.length < 4) {
      return encodeError("wrong number of arguments for 'GEOADD' command");
    }
    const key = args[0];
    let nx = false, xx = false, ch = false;
    let i = 1;
    // Parse optional flags
    while (i < args.length) {
      const opt = args[i].toUpperCase();
      if (opt === 'NX') { nx = true; i++; }
      else if (opt === 'XX') { xx = true; i++; }
      else if (opt === 'CH') { ch = true; i++; }
      else break;
    }
    // Remaining args: longitude latitude member triplets
    const remaining = args.length - i;
    if (remaining < 3 || remaining % 3 !== 0) {
      return encodeError("wrong number of arguments for 'GEOADD' command");
    }
    const members: Array<{ longitude: number; latitude: number; member: string }> = [];
    for (let j = i; j < args.length; j += 3) {
      const longitude = parseFloat(args[j]);
      const latitude = parseFloat(args[j + 1]);
      if (isNaN(longitude) || isNaN(latitude)) {
        return encodeError('ERR value is not a valid float');
      }
      if (longitude < -180 || longitude > 180) {
        return encodeError('ERR invalid longitude, valid range is [-180, 180]');
      }
      if (latitude < -85.05112878 || latitude > 85.05112878) {
        return encodeError('ERR invalid latitude, valid range is [-85.05112878, 85.05112878]');
      }
      members.push({ longitude, latitude, member: args[j + 2] });
    }
    const options: { nx?: boolean; xx?: boolean; ch?: boolean } = {};
    if (nx) options.nx = true;
    if (xx) options.xx = true;
    if (ch) options.ch = true;
    const result = await this.storage.geoadd(key, members, options);
    return encodeInteger(result);
  }

  private async handleGeohash(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'GEOHASH' command");
    }
    const key = args[0];
    const members = args.slice(1);
    const result = await this.storage.geohash(key, members);
    const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleGeopos(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'GEOPOS' command");
    }
    const key = args[0];
    const members = args.slice(1);
    const result = await this.storage.geopos(key, members);
    const parts = result.map(r => {
      if (r === null) return encodeBulkString(null);
      // Each element is [longitude, latitude]
      return `*2\r\n${encodeBulkString(String(r[0]))}${encodeBulkString(String(r[1]))}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleGeodist(args: string[]): Promise<string> {
    if (args.length < 3) {
      return encodeError("wrong number of arguments for 'GEODIST' command");
    }
    const key = args[0];
    const member1 = args[1];
    const member2 = args[2];
    let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
    if (args.length >= 4) {
      const u = args[3].toLowerCase();
      if (u === 'km' || u === 'ft' || u === 'mi' || u === 'm') {
        unit = u as 'm' | 'km' | 'ft' | 'mi';
      } else {
        return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
      }
    }
    const result = await this.storage.geodist(key, member1, member2, unit);
    if (result === null) return encodeBulkString(null);
    return encodeBulkString(String(result));
  }

  private async handleGeoradius(args: string[]): Promise<string> {
    if (args.length < 5) {
      return encodeError("wrong number of arguments for 'GEORADIUS' command");
    }
    const key = args[0];
    const longitude = parseFloat(args[1]);
    const latitude = parseFloat(args[2]);
    const radius = parseFloat(args[3]);
    if (isNaN(longitude) || isNaN(latitude) || isNaN(radius)) {
      return encodeError('ERR value is not a valid float');
    }
    const unitArg = args[4].toLowerCase();
    let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
    if (unitArg === 'km' || unitArg === 'ft' || unitArg === 'mi' || unitArg === 'm') {
      unit = unitArg as 'm' | 'km' | 'ft' | 'mi';
    } else {
      return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
    }
    let withCoord = false, withDist = false, withHash = false;
    let count: number | undefined;
    let sort: 'ASC' | 'DESC' | undefined;
    let store: string | undefined;
    let storeDist: string | undefined;
    for (let i = 5; i < args.length; i++) {
      const opt = args[i].toUpperCase();
      if (opt === 'WITHCOORD') { withCoord = true; }
      else if (opt === 'WITHDIST') { withDist = true; }
      else if (opt === 'WITHASH') { withHash = true; }
      else if (opt === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      }
      else if (opt === 'ASC') { sort = 'ASC'; }
      else if (opt === 'DESC') { sort = 'DESC'; }
      else if (opt === 'STORE') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        store = args[i];
      }
      else if (opt === 'STOREDIST') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        storeDist = args[i];
      }
    }
    const options: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string } = {};
    if (withCoord) options.withCoord = true;
    if (withDist) options.withDist = true;
    if (withHash) options.withHash = true;
    if (count !== undefined) options.count = count;
    if (sort) options.sort = sort;
    if (store) options.store = store;
    if (storeDist) options.storeDist = storeDist;
    const result = await this.storage.georadius(key, longitude, latitude, radius, unit, options);
    // If STORE or STOREDIST was used, return integer (count)
    if (store || storeDist) {
      return encodeInteger(result.length);
    }
    if (!withCoord && !withDist && !withHash) {
      // Just member names
      return encodeArray(result.map(r => r.member));
    }
    // Array of arrays
    const parts = result.map(r => {
      const items: string[] = [encodeBulkString(r.member)];
      if (withDist) items.push(encodeBulkString(String(r.distance)));
      if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
      if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
        items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
      }
      return `*${items.length}\r\n${items.join('')}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleGeoradiusbymember(args: string[]): Promise<string> {
    if (args.length < 4) {
      return encodeError("wrong number of arguments for 'GEORADIUSBYMEMBER' command");
    }
    const key = args[0];
    const member = args[1];
    const radius = parseFloat(args[2]);
    if (isNaN(radius)) {
      return encodeError('ERR value is not a valid float');
    }
    const unitArg = args[3].toLowerCase();
    let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
    if (unitArg === 'km' || unitArg === 'ft' || unitArg === 'mi' || unitArg === 'm') {
      unit = unitArg as 'm' | 'km' | 'ft' | 'mi';
    } else {
      return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
    }
    let withCoord = false, withDist = false, withHash = false;
    let count: number | undefined;
    let sort: 'ASC' | 'DESC' | undefined;
    let store: string | undefined;
    let storeDist: string | undefined;
    for (let i = 4; i < args.length; i++) {
      const opt = args[i].toUpperCase();
      if (opt === 'WITHCOORD') { withCoord = true; }
      else if (opt === 'WITHDIST') { withDist = true; }
      else if (opt === 'WITHASH') { withHash = true; }
      else if (opt === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      }
      else if (opt === 'ASC') { sort = 'ASC'; }
      else if (opt === 'DESC') { sort = 'DESC'; }
      else if (opt === 'STORE') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        store = args[i];
      }
      else if (opt === 'STOREDIST') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        storeDist = args[i];
      }
    }
    const options: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC'; store?: string; storeDist?: string } = {};
    if (withCoord) options.withCoord = true;
    if (withDist) options.withDist = true;
    if (withHash) options.withHash = true;
    if (count !== undefined) options.count = count;
    if (sort) options.sort = sort;
    if (store) options.store = store;
    if (storeDist) options.storeDist = storeDist;
    const result = await this.storage.georadiusbymember(key, member, radius, unit, options);
    if (store || storeDist) {
      return encodeInteger(result.length);
    }
    if (!withCoord && !withDist && !withHash) {
      return encodeArray(result.map(r => r.member));
    }
    const parts = result.map(r => {
      const items: string[] = [encodeBulkString(r.member)];
      if (withDist) items.push(encodeBulkString(String(r.distance)));
      if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
      if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
        items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
      }
      return `*${items.length}\r\n${items.join('')}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleGeosearch(args: string[]): Promise<string> {
    if (args.length < 4) {
      return encodeError("wrong number of arguments for 'GEOSEARCH' command");
    }
    const key = args[0];
    let fromMember: string | undefined;
    let fromLongitude: number | undefined;
    let fromLatitude: number | undefined;
    let byRadius: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' } | undefined;
    let byBox: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' } | undefined;
    let sort: 'ASC' | 'DESC' | undefined;
    let count: number | undefined;
    let any: boolean | undefined;
    let withCoord = false, withDist = false, withHash = false;

    let i = 1;
    while (i < args.length) {
      const opt = args[i].toUpperCase();
      if (opt === 'FROMMEMBER') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        fromMember = args[i]; i++;
      } else if (opt === 'FROMLONGITUDE') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        fromLongitude = parseFloat(args[i]);
        if (isNaN(fromLongitude)) return encodeError('ERR value is not a valid float');
        i++;
      } else if (opt === 'FROMLATITUDE') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        fromLatitude = parseFloat(args[i]);
        if (isNaN(fromLatitude)) return encodeError('ERR value is not a valid float');
        i++;
      } else if (opt === 'BYRADIUS') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const radius = parseFloat(args[i]);
        if (isNaN(radius)) return encodeError('ERR value is not a valid float');
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const unitArg = args[i].toLowerCase();
        if (!['m', 'km', 'ft', 'mi'].includes(unitArg)) return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
        byRadius = { radius, unit: unitArg as 'm' | 'km' | 'ft' | 'mi' };
        i++;
      } else if (opt === 'BYBOX') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const width = parseFloat(args[i]);
        if (isNaN(width)) return encodeError('ERR value is not a valid float');
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const height = parseFloat(args[i]);
        if (isNaN(height)) return encodeError('ERR value is not a valid float');
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const unitArg = args[i].toLowerCase();
        if (!['m', 'km', 'ft', 'mi'].includes(unitArg)) return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
        byBox = { width, height, unit: unitArg as 'm' | 'km' | 'ft' | 'mi' };
        i++;
      } else if (opt === 'ASC') { sort = 'ASC'; i++; }
      else if (opt === 'DESC') { sort = 'DESC'; i++; }
      else if (opt === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
        i++;
        // Check for ANY flag
        if (i < args.length && args[i].toUpperCase() === 'ANY') { any = true; i++; }
      } else if (opt === 'WITHCOORD') { withCoord = true; i++; }
      else if (opt === 'WITHDIST') { withDist = true; i++; }
      else if (opt === 'WITHASH') { withHash = true; i++; }
      else { return encodeError('ERR syntax error'); }
    }

    const options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; withCoord?: boolean; withDist?: boolean; withHash?: boolean } = {};
    if (fromMember !== undefined) options.fromMember = fromMember;
    if (fromLongitude !== undefined) options.fromLongitude = fromLongitude;
    if (fromLatitude !== undefined) options.fromLatitude = fromLatitude;
    if (byRadius) options.byRadius = byRadius;
    if (byBox) options.byBox = byBox;
    if (sort) options.sort = sort;
    if (count !== undefined) options.count = count;
    if (any) options.any = true;
    if (withCoord) options.withCoord = true;
    if (withDist) options.withDist = true;
    if (withHash) options.withHash = true;

    const result = await this.storage.geosearch(key, options);
    if (!withCoord && !withDist && !withHash) {
      return encodeArray(result.map(r => r.member));
    }
    const parts = result.map(r => {
      const items: string[] = [encodeBulkString(r.member)];
      if (withDist) items.push(encodeBulkString(String(r.distance)));
      if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
      if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
        items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
      }
      return `*${items.length}\r\n${items.join('')}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleGeosearchstore(args: string[]): Promise<string> {
    if (args.length < 5) {
      return encodeError("wrong number of arguments for 'GEOSEARCHSTORE' command");
    }
    const destination = args[0];
    const source = args[1];
    let fromMember: string | undefined;
    let fromLongitude: number | undefined;
    let fromLatitude: number | undefined;
    let byRadius: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' } | undefined;
    let byBox: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' } | undefined;
    let sort: 'ASC' | 'DESC' | undefined;
    let count: number | undefined;
    let any: boolean | undefined;
    let storeDist = false;

    let i = 2;
    while (i < args.length) {
      const opt = args[i].toUpperCase();
      if (opt === 'FROMMEMBER') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        fromMember = args[i]; i++;
      } else if (opt === 'FROMLONGITUDE') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        fromLongitude = parseFloat(args[i]);
        if (isNaN(fromLongitude)) return encodeError('ERR value is not a valid float');
        i++;
      } else if (opt === 'FROMLATITUDE') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        fromLatitude = parseFloat(args[i]);
        if (isNaN(fromLatitude)) return encodeError('ERR value is not a valid float');
        i++;
      } else if (opt === 'BYRADIUS') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const radius = parseFloat(args[i]);
        if (isNaN(radius)) return encodeError('ERR value is not a valid float');
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const unitArg = args[i].toLowerCase();
        if (!['m', 'km', 'ft', 'mi'].includes(unitArg)) return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
        byRadius = { radius, unit: unitArg as 'm' | 'km' | 'ft' | 'mi' };
        i++;
      } else if (opt === 'BYBOX') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const width = parseFloat(args[i]);
        if (isNaN(width)) return encodeError('ERR value is not a valid float');
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const height = parseFloat(args[i]);
        if (isNaN(height)) return encodeError('ERR value is not a valid float');
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        const unitArg = args[i].toLowerCase();
        if (!['m', 'km', 'ft', 'mi'].includes(unitArg)) return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
        byBox = { width, height, unit: unitArg as 'm' | 'km' | 'ft' | 'mi' };
        i++;
      } else if (opt === 'ASC') { sort = 'ASC'; i++; }
      else if (opt === 'DESC') { sort = 'DESC'; i++; }
      else if (opt === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
        i++;
        if (i < args.length && args[i].toUpperCase() === 'ANY') { any = true; i++; }
      } else if (opt === 'STOREDIST') { storeDist = true; i++; }
      else { return encodeError('ERR syntax error'); }
    }

    const options: { fromMember?: string; fromLongitude?: number; fromLatitude?: number; byRadius?: { radius: number; unit: 'm' | 'km' | 'ft' | 'mi' }; byBox?: { width: number; height: number; unit: 'm' | 'km' | 'ft' | 'mi' }; sort?: 'ASC' | 'DESC'; count?: number; any?: boolean; storeDist?: boolean } = {};
    if (fromMember !== undefined) options.fromMember = fromMember;
    if (fromLongitude !== undefined) options.fromLongitude = fromLongitude;
    if (fromLatitude !== undefined) options.fromLatitude = fromLatitude;
    if (byRadius) options.byRadius = byRadius;
    if (byBox) options.byBox = byBox;
    if (sort) options.sort = sort;
    if (count !== undefined) options.count = count;
    if (any) options.any = true;
    if (storeDist) options.storeDist = true;

    const result = await this.storage.geosearchstore(destination, source, options);
    return encodeInteger(result);
  }

  private async handleGeoradiusRo(args: string[]): Promise<string> {
    // Same as GEORADIUS but STORE/STOREDIST are not allowed
    if (args.length < 5) {
      return encodeError("wrong number of arguments for 'GEORADIUS_RO' command");
    }
    const key = args[0];
    const longitude = parseFloat(args[1]);
    const latitude = parseFloat(args[2]);
    const radius = parseFloat(args[3]);
    if (isNaN(longitude) || isNaN(latitude) || isNaN(radius)) {
      return encodeError('ERR value is not a valid float');
    }
    const unitArg = args[4].toLowerCase();
    let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
    if (unitArg === 'km' || unitArg === 'ft' || unitArg === 'mi' || unitArg === 'm') {
      unit = unitArg as 'm' | 'km' | 'ft' | 'mi';
    } else {
      return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
    }
    let withCoord = false, withDist = false, withHash = false;
    let count: number | undefined;
    let sort: 'ASC' | 'DESC' | undefined;
    for (let i = 5; i < args.length; i++) {
      const opt = args[i].toUpperCase();
      if (opt === 'WITHCOORD') { withCoord = true; }
      else if (opt === 'WITHDIST') { withDist = true; }
      else if (opt === 'WITHASH') { withHash = true; }
      else if (opt === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      }
      else if (opt === 'ASC') { sort = 'ASC'; }
      else if (opt === 'DESC') { sort = 'DESC'; }
      else if (opt === 'STORE' || opt === 'STOREDIST') {
        return encodeError(`${opt} option is not allowed on GEORADIUS_RO`);
      }
    }
    const options: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC' } = {};
    if (withCoord) options.withCoord = true;
    if (withDist) options.withDist = true;
    if (withHash) options.withHash = true;
    if (count !== undefined) options.count = count;
    if (sort) options.sort = sort;
    const result = await this.storage.georadius(key, longitude, latitude, radius, unit, options);
    if (!withCoord && !withDist && !withHash) {
      return encodeArray(result.map(r => r.member));
    }
    const parts = result.map(r => {
      const items: string[] = [encodeBulkString(r.member)];
      if (withDist) items.push(encodeBulkString(String(r.distance)));
      if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
      if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
        items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
      }
      return `*${items.length}\r\n${items.join('')}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleGeoradiusbymemberRo(args: string[]): Promise<string> {
    // Same as GEORADIUSBYMEMBER but STORE/STOREDIST are not allowed
    if (args.length < 4) {
      return encodeError("wrong number of arguments for 'GEORADIUSBYMEMBER_RO' command");
    }
    const key = args[0];
    const member = args[1];
    const radius = parseFloat(args[2]);
    if (isNaN(radius)) {
      return encodeError('ERR value is not a valid float');
    }
    const unitArg = args[3].toLowerCase();
    let unit: 'm' | 'km' | 'ft' | 'mi' = 'm';
    if (unitArg === 'km' || unitArg === 'ft' || unitArg === 'mi' || unitArg === 'm') {
      unit = unitArg as 'm' | 'km' | 'ft' | 'mi';
    } else {
      return encodeError('ERR unsupported unit provided. please use m, km, ft, mi');
    }
    let withCoord = false, withDist = false, withHash = false;
    let count: number | undefined;
    let sort: 'ASC' | 'DESC' | undefined;
    for (let i = 4; i < args.length; i++) {
      const opt = args[i].toUpperCase();
      if (opt === 'WITHCOORD') { withCoord = true; }
      else if (opt === 'WITHDIST') { withDist = true; }
      else if (opt === 'WITHASH') { withHash = true; }
      else if (opt === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      }
      else if (opt === 'ASC') { sort = 'ASC'; }
      else if (opt === 'DESC') { sort = 'DESC'; }
      else if (opt === 'STORE' || opt === 'STOREDIST') {
        return encodeError(`${opt} option is not allowed on GEORADIUSBYMEMBER_RO`);
      }
    }
    const options: { withCoord?: boolean; withDist?: boolean; withHash?: boolean; count?: number; sort?: 'ASC' | 'DESC' } = {};
    if (withCoord) options.withCoord = true;
    if (withDist) options.withDist = true;
    if (withHash) options.withHash = true;
    if (count !== undefined) options.count = count;
    if (sort) options.sort = sort;
    const result = await this.storage.georadiusbymember(key, member, radius, unit, options);
    if (!withCoord && !withDist && !withHash) {
      return encodeArray(result.map(r => r.member));
    }
    const parts = result.map(r => {
      const items: string[] = [encodeBulkString(r.member)];
      if (withDist) items.push(encodeBulkString(String(r.distance)));
      if (withHash) items.push(encodeInteger(r.geohash ? parseInt(String(r.geohash)) : 0));
      if (withCoord && r.longitude !== undefined && r.latitude !== undefined) {
        items.push(`*2\r\n${encodeBulkString(String(r.longitude))}${encodeBulkString(String(r.latitude))}`);
      }
      return `*${items.length}\r\n${items.join('')}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  // === Stream operations ===

  private encodeStreamEntry(entry: { id: string; fields: Record<string, string> }): string {
    const flat: string[] = [entry.id];
    for (const [k, v] of Object.entries(entry.fields)) {
      flat.push(k, v);
    }
    return encodeArray(flat);
  }

  private async handleXadd(args: string[]): Promise<string> {
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
        nomkstream = true; i++;
      } else if (opt === 'MAXLEN') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        approx = false;
        if (args[i] === '~') { approx = true; i++; if (i >= args.length) return encodeError('ERR syntax error'); }
        maxlen = parseInt(args[i]);
        if (isNaN(maxlen) || maxlen < 0) return encodeError('ERR value is not an integer or out of range');
        i++;
        // Check for LIMIT after MAXLEN
        if (i < args.length && args[i].toUpperCase() === 'LIMIT') {
          i++; if (i >= args.length) return encodeError('ERR syntax error');
          limit = parseInt(args[i]);
          if (isNaN(limit)) return encodeError('ERR value is not an integer or out of range');
          i++;
        }
      } else if (opt === 'MINID') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        approx = false;
        if (args[i] === '~') { approx = true; i++; if (i >= args.length) return encodeError('ERR syntax error'); }
        minid = args[i];
        i++;
        if (i < args.length && args[i].toUpperCase() === 'LIMIT') {
          i++; if (i >= args.length) return encodeError('ERR syntax error');
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

    const options: { maxlen?: number; approx?: boolean; minid?: string; nomkstream?: boolean; limit?: number } = {};
    if (maxlen !== undefined) { options.maxlen = maxlen; options.approx = approx; }
    if (minid !== undefined) { options.minid = minid; options.approx = approx; }
    if (nomkstream) options.nomkstream = true;
    if (limit !== undefined) options.limit = limit;

    const result = await this.storage.xadd(key, id, fields, options);
    if (result === null) return encodeBulkString(null);
    return encodeBulkString(result);
  }

  private async handleXtrim(args: string[]): Promise<string> {
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
    if (args[i] === '~') { approx = true; i++; }
    threshold = strategy === 'MAXLEN' ? parseInt(args[i]) : args[i];
    if (strategy === 'MAXLEN' && isNaN(threshold as number)) {
      return encodeError('ERR value is not an integer or out of range');
    }
    i++;
    if (i < args.length && args[i].toUpperCase() === 'LIMIT') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
      limit = parseInt(args[i]);
      if (isNaN(limit)) return encodeError('ERR value is not an integer or out of range');
    }
    const result = await this.storage.xtrim(key, strategy, threshold, approx, limit);
    return encodeInteger(result);
  }

  private async handleXdel(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'XDEL' command");
    }
    const key = args[0];
    const ids = args.slice(1);
    const result = await this.storage.xdel(key, ids);
    return encodeInteger(result);
  }

  private async handleXrange(args: string[]): Promise<string> {
    if (args.length < 3) {
      return encodeError("wrong number of arguments for 'XRANGE' command");
    }
    const key = args[0];
    const start = args[1];
    const end = args[2];
    let count: number | undefined;
    for (let i = 3; i < args.length; i++) {
      if (args[i].toUpperCase() === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      }
    }
    const result = await this.storage.xrange(key, start, end, count);
    const parts = result.map(e => this.encodeStreamEntry(e));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleXrevrange(args: string[]): Promise<string> {
    if (args.length < 3) {
      return encodeError("wrong number of arguments for 'XREVRANGE' command");
    }
    const key = args[0];
    const end = args[1]; // Note: XREVRANGE args are end then start
    const start = args[2];
    let count: number | undefined;
    for (let i = 3; i < args.length; i++) {
      if (args[i].toUpperCase() === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      }
    }
    const result = await this.storage.xrevrange(key, end, start, count);
    const parts = result.map(e => this.encodeStreamEntry(e));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleXlen(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'XLEN' command");
    }
    const result = await this.storage.xlen(args[0]);
    return encodeInteger(result);
  }

  private async handleXread(args: string[]): Promise<string> {
    let count: number | undefined;
    let block: number | undefined;
    let i = 0;
    while (i < args.length) {
      const opt = args[i].toUpperCase();
      if (opt === 'COUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
        i++;
      } else if (opt === 'BLOCK') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
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

    // If BLOCK > 0, return null immediately (non-blocking implementation)
    if (block !== undefined && block > 0) {
      // For blocking reads, we just return null (no data available immediately)
      // A real implementation would wait, but here we return null
    }

    const result = await this.storage.xread(keys, ids, count);
    if (result === null) return encodeArray(null);
    // Format: array of [key, [entries...]]
    const parts = result.map(stream => {
      const keyEnc = encodeBulkString(stream.key);
      const entriesEnc = `*${stream.entries.length}\r\n${stream.entries.map(e => this.encodeStreamEntry(e)).join('')}`;
      return `*2\r\n${keyEnc}${entriesEnc}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleXgroup(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'XGROUP' command");
    const sub = args[0].toUpperCase();
    switch (sub) {
      case 'CREATE': return await this.handleXgroupCreate(args.slice(1));
      case 'DESTROY': return await this.handleXgroupDestroy(args.slice(1));
      case 'CREATECONSUMER': return await this.handleXgroupCreateconsumer(args.slice(1));
      case 'DELCONSUMER': return await this.handleXgroupDelconsumer(args.slice(1));
      case 'SETID': return await this.handleXgroupSetid(args.slice(1));
      default: return encodeError(`unknown subcommand '${args[0]}'`);
    }
  }

  private async handleXgroupCreate(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'XGROUP CREATE' command");
    const key = args[0];
    const group = args[1];
    let id = args[2];
    let mkstream = false;
    for (let i = 3; i < args.length; i++) {
      if (args[i].toUpperCase() === 'MKSTREAM') { mkstream = true; }
    }
    const result = await this.storage.xgroupCreate(key, group, id, mkstream);
    return encodeSimpleString(result);
  }

  private async handleXgroupDestroy(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'XGROUP DESTROY' command");
    const key = args[0];
    const group = args[1];
    const result = await this.storage.xgroupDestroy(key, group);
    return encodeInteger(result);
  }

  private async handleXgroupCreateconsumer(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'XGROUP CREATECONSUMER' command");
    const key = args[0];
    const group = args[1];
    const consumer = args[2];
    const result = await this.storage.xgroupCreateconsumer(key, group, consumer);
    return encodeInteger(result);
  }

  private async handleXgroupDelconsumer(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'XGROUP DELCONSUMER' command");
    const key = args[0];
    const group = args[1];
    const consumer = args[2];
    const result = await this.storage.xgroupDelconsumer(key, group, consumer);
    return encodeInteger(result);
  }

  private async handleXgroupSetid(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'XGROUP SETID' command");
    const key = args[0];
    const group = args[1];
    const id = args[2];
    const result = await this.storage.xgroupSetid(key, group, id);
    return encodeSimpleString(result);
  }

  private async handleXreadgroup(args: string[]): Promise<string> {
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
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
        i++;
      } else if (opt === 'BLOCK') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        block = parseInt(args[i]);
        if (isNaN(block)) return encodeError('ERR value is not an integer or out of range');
        i++;
      } else if (opt === 'NOACK') {
        noack = true; i++;
      } else if (opt === 'STREAMS') {
        i++; break;
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

    const result = await this.storage.xreadgroup(group, consumer, keys, ids, count, noack);
    if (result === null) return encodeArray(null);
    const parts = result.map(stream => {
      const keyEnc = encodeBulkString(stream.key);
      const entriesEnc = `*${stream.entries.length}\r\n${stream.entries.map(e => this.encodeStreamEntry(e)).join('')}`;
      return `*2\r\n${keyEnc}${entriesEnc}`;
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleXack(args: string[]): Promise<string> {
    if (args.length < 3) return encodeError("wrong number of arguments for 'XACK' command");
    const key = args[0];
    const group = args[1];
    const ids = args.slice(2);
    const result = await this.storage.xack(key, group, ids);
    return encodeInteger(result);
  }

  private async handleXpending(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'XPENDING' command");
    const key = args[0];
    const group = args[1];

    // Two forms:
    // XPENDING key group [[IDLE min-idle] start end count [consumer]]
    if (args.length === 2) {
      // Summary form
      const result = await this.storage.xpending(key, group);
      if (Array.isArray(result)) {
        // Detailed form result (shouldn't happen here but handle)
        const entries = result as import('../storage/interface').PendingEntry[];
        const parts = entries.map(e => {
          return `*4\r\n${encodeBulkString(e.id)}${encodeBulkString(e.consumer)}${encodeInteger(Math.floor(e.deliveredTime))}${encodeInteger(e.deliveryCount)}`;
        });
        return `*${parts.length}\r\n${parts.join('')}`;
      }
      // Summary: { count, minId, maxId, consumers }
      const summary = result as { count: number; minId: string | null; maxId: string | null; consumers: Array<{ name: string; pending: number }> };
      const consumerParts = summary.consumers.map(c => {
        return `*2\r\n${encodeBulkString(c.name)}${encodeInteger(c.pending)}`;
      });
      return `*${4 + consumerParts.length}\r\n${encodeInteger(summary.count)}${encodeBulkString(summary.minId)}${encodeBulkString(summary.maxId)}${encodeInteger(consumerParts.length)}${consumerParts.join('')}`;
    }

    // Detailed form
    let i = 2;
    let idle: number | undefined;
    if (args[i].toUpperCase() === 'IDLE') {
      i++; if (i >= args.length) return encodeError('ERR syntax error');
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
    const options: { start?: string; end?: string; count?: number; consumer?: string; idle?: number } = {};
    options.start = start;
    options.end = end;
    options.count = count;
    if (consumer) options.consumer = consumer;
    if (idle !== undefined) options.idle = idle;
    const result = await this.storage.xpending(key, group, options);
    // Detailed form returns PendingEntry[]
    if (Array.isArray(result)) {
      const entries = result as import('../storage/interface').PendingEntry[];
      const parts = entries.map(e => {
        return `*4\r\n${encodeBulkString(e.id)}${encodeBulkString(e.consumer)}${encodeInteger(Math.floor(e.deliveredTime))}${encodeInteger(e.deliveryCount)}`;
      });
      return `*${parts.length}\r\n${parts.join('')}`;
    }
    // Summary (shouldn't reach here usually)
    const summary = result as { count: number; minId: string | null; maxId: string | null; consumers: Array<{ name: string; pending: number }> };
    const consumerParts = summary.consumers.map(c => {
      return `*2\r\n${encodeBulkString(c.name)}${encodeInteger(c.pending)}`;
    });
    return `*4\r\n${encodeInteger(summary.count)}${encodeBulkString(summary.minId)}${encodeBulkString(summary.maxId)}${encodeInteger(consumerParts.length)}${consumerParts.join('')}`;
  }

  private async handleXclaim(args: string[]): Promise<string> {
    if (args.length < 5) return encodeError("wrong number of arguments for 'XCLAIM' command");
    const key = args[0];
    const group = args[1];
    const consumer = args[2];
    const minIdleTime = parseInt(args[3]);
    if (isNaN(minIdleTime)) return encodeError('ERR value is not an integer or out of range');
    // Parse IDs until we hit a flag
    const ids: string[] = [];
    let i = 4;
    while (i < args.length && !args[i].toUpperCase().startsWith('IDLE') && !args[i].toUpperCase().startsWith('TIME') && !args[i].toUpperCase().startsWith('RETRYCOUNT') && args[i].toUpperCase() !== 'FORCE' && args[i].toUpperCase() !== 'JUSTID') {
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
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        idle = parseInt(args[i]);
        if (isNaN(idle)) return encodeError('ERR value is not an integer or out of range');
        i++;
      } else if (opt === 'TIME') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        time = parseInt(args[i]);
        if (isNaN(time)) return encodeError('ERR value is not an integer or out of range');
        i++;
      } else if (opt === 'RETRYCOUNT') {
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        retrycount = parseInt(args[i]);
        if (isNaN(retrycount)) return encodeError('ERR value is not an integer or out of range');
        i++;
      } else if (opt === 'FORCE') {
        force = true; i++;
      } else if (opt === 'JUSTID') {
        justid = true; i++;
      } else {
        // Treat as ID
        ids.push(args[i]); i++;
      }
    }
    const options: { idle?: number; time?: number; retrycount?: number; force?: boolean; justid?: boolean } = {};
    if (idle !== undefined) options.idle = idle;
    if (time !== undefined) options.time = time;
    if (retrycount !== undefined) options.retrycount = retrycount;
    if (force) options.force = true;
    if (justid) options.justid = true;

    const result = await this.storage.xclaim(key, group, consumer, minIdleTime, ids, options);
    if (justid) {
      // Result is string[] (just IDs)
      const idList = result as string[];
      return encodeArray(idList);
    }
    // Result is StreamEntry[]
    const entries = result as import('../storage/interface').StreamEntry[];
    const parts = entries.map(e => this.encodeStreamEntry(e));
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleXautoclaim(args: string[]): Promise<string> {
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
        i++; if (i >= args.length) return encodeError('ERR syntax error');
        count = parseInt(args[i]);
        if (isNaN(count)) return encodeError('ERR value is not an integer or out of range');
      } else if (opt === 'JUSTID') {
        justid = true;
      }
    }
    const options: { count?: number; justid?: boolean } = {};
    if (count !== undefined) options.count = count;
    if (justid) options.justid = true;

    const result = await this.storage.xautoclaim(key, group, consumer, minIdleTime, start, options);
    if (justid) {
      // Result.entries is string[]
      const entries = result.entries as string[];
      return `*2\r\n${encodeBulkString(result.nextStartId)}${encodeArray(entries)}`;
    }
    // Result.entries is StreamEntry[]
    const entries = result.entries as import('../storage/interface').StreamEntry[];
    const parts = entries.map(e => this.encodeStreamEntry(e));
    return `*2\r\n${encodeBulkString(result.nextStartId)}*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleXinfo(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'XINFO' command");
    const sub = args[0].toUpperCase();
    switch (sub) {
      case 'STREAM': return await this.handleXinfoStream(args.slice(1));
      case 'GROUPS': return await this.handleXinfoGroups(args.slice(1));
      case 'CONSUMERS': return await this.handleXinfoConsumers(args.slice(1));
      default: return encodeError(`unknown subcommand '${args[0]}'`);
    }
  }

  private async handleXinfoStream(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'XINFO STREAM' command");
    const key = args[0];
    const result = await this.storage.xinfoStream(key);
    // Return as flat array of field-value pairs
    const items: string[] = [
      'length', String(result.length),
      'first-entry', result.firstEntry ? this.encodeStreamEntry(result.firstEntry) : encodeBulkString(null),
      'last-entry', result.lastEntry ? this.encodeStreamEntry(result.lastEntry) : encodeBulkString(null),
      'max-deleted-entry-id', String(result.maxDeletedEntryId),
      'entries-added', String(result.entriesAdded),
      'recorded-first-entry-id', String(result.recordedFirstEntryId),
      'groups', String(result.groups),
    ];
    return encodeArray(items);
  }

  private async handleXinfoGroups(args: string[]): Promise<string> {
    if (args.length < 1) return encodeError("wrong number of arguments for 'XINFO GROUPS' command");
    const key = args[0];
    const result = await this.storage.xinfoGroups(key);
    const parts = result.map(g => {
      const items = [
        'name', g.name,
        'consumers', String(g.consumers),
        'pending', String(g.pending),
        'last-delivered-id', g.lastDeliveredId,
        'entries-read', String(g.entriesRead),
        'lag', String(g.lag),
      ];
      return encodeArray(items);
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleXinfoConsumers(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'XINFO CONSUMERS' command");
    const key = args[0];
    const group = args[1];
    const result = await this.storage.xinfoConsumers(key, group);
    const parts = result.map(c => {
      const items = [
        'name', c.name,
        'pending', String(c.pendingCount),
        'idle', String(c.idleTime),
      ];
      return encodeArray(items);
    });
    return `*${parts.length}\r\n${parts.join('')}`;
  }

  private async handleXsetid(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'XSETID' command");
    const key = args[0];
    const id = args[1];
    const result = await this.storage.xsetid(key, id);
    return encodeSimpleString(result);
  }

  // === Sort operations ===

  private async handleSort(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'SORT' command");
    }
    const key = args[0];
    let byPattern: string | undefined;
    let limit: { offset: number; count: number } | undefined;
    const getPatterns: string[] = [];
    let sortOrder: 'ASC' | 'DESC' = 'ASC';
    let alpha = false;
    let store: string | undefined;

    let i = 1;
    while (i < args.length) {
      const opt = args[i].toUpperCase();
      switch (opt) {
        case 'BY':
          i++;
          if (i >= args.length) return encodeError('ERR syntax error');
          byPattern = args[i];
          break;
        case 'LIMIT':
          i++;
          if (i + 1 >= args.length) return encodeError('ERR syntax error');
          const offset = parseInt(args[i]);
          i++;
          const count = parseInt(args[i]);
          if (isNaN(offset) || isNaN(count)) return encodeError('ERR value is not an integer or out of range');
          limit = { offset, count };
          break;
        case 'GET':
          i++;
          if (i >= args.length) return encodeError('ERR syntax error');
          getPatterns.push(args[i]);
          break;
        case 'ASC':
          sortOrder = 'ASC';
          break;
        case 'DESC':
          sortOrder = 'DESC';
          break;
        case 'ALPHA':
          alpha = true;
          break;
        case 'STORE':
          i++;
          if (i >= args.length) return encodeError('ERR syntax error');
          store = args[i];
          break;
        default:
          return encodeError('ERR syntax error');
      }
      i++;
    }

    try {
      const result = await this.storage.sort(key, {
        byPattern,
        limit,
        getPatterns: getPatterns.length > 0 ? getPatterns : undefined,
        sortOrder,
        alpha,
        store,
      });
      if (typeof result === 'number') {
        return encodeInteger(result);
      }
      return encodeArray(result);
    } catch (e: any) {
      if (e.message.startsWith('WRONGTYPE')) {
        return `-${e.message}\r\n`;
      }
      return encodeError(e.message);
    }
  }

  private async handleSortRo(args: string[]): Promise<string> {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'SORT_RO' command");
    }
    const key = args[0];
    let byPattern: string | undefined;
    let limit: { offset: number; count: number } | undefined;
    const getPatterns: string[] = [];
    let sortOrder: 'ASC' | 'DESC' = 'ASC';
    let alpha = false;
    let store: string | undefined;

    let i = 1;
    while (i < args.length) {
      const opt = args[i].toUpperCase();
      switch (opt) {
        case 'BY':
          i++;
          if (i >= args.length) return encodeError('ERR syntax error');
          byPattern = args[i];
          break;
        case 'LIMIT':
          i++;
          if (i + 1 >= args.length) return encodeError('ERR syntax error');
          const offset = parseInt(args[i]);
          i++;
          const count = parseInt(args[i]);
          if (isNaN(offset) || isNaN(count)) return encodeError('ERR value is not an integer or out of range');
          limit = { offset, count };
          break;
        case 'GET':
          i++;
          if (i >= args.length) return encodeError('ERR syntax error');
          getPatterns.push(args[i]);
          break;
        case 'ASC':
          sortOrder = 'ASC';
          break;
        case 'DESC':
          sortOrder = 'DESC';
          break;
        case 'ALPHA':
          alpha = true;
          break;
        case 'STORE':
          i++;
          if (i >= args.length) return encodeError('ERR syntax error');
          store = args[i];
          break;
        default:
          return encodeError('ERR syntax error');
      }
      i++;
    }

    // SORT_RO rejects STORE
    if (store !== undefined) {
      return encodeError("SORT_RO can't be used with STORE option");
    }

    try {
      const result = await this.storage.sort(key, {
        byPattern,
        limit,
        getPatterns: getPatterns.length > 0 ? getPatterns : undefined,
        sortOrder,
        alpha,
      });
      if (typeof result === 'number') {
        return encodeInteger(result);
      }
      return encodeArray(result);
    } catch (e: any) {
      if (e.message.startsWith('WRONGTYPE')) {
        return `-${e.message}\r\n`;
      }
      return encodeError(e.message);
    }
  }
}