// Redis 명령 핸들러
// 파싱된 명령을 받아 스토리지에 대한 CRUD 작업을 수행하고
// RESP 프로토콜 형식의 응답을 반환합니다.

import { IStorage } from '../storage/interface';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../protocol/resp';

export class CommandHandler {
  private storage: IStorage;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  async execute(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError('unknown command');
    }

    const command = args[0].toUpperCase();

    try {
      switch (command) {
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
          return this.handleCommand();

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
        case 'DBSIZE':
          return await this.handleDbsize();
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

  private handleCommand(): string {
    const commands = [
      'PING', 'SET', 'GET', 'DEL', 'KEYS', 'EXISTS', 'FLUSHDB', 'FLUSHALL', 'COMMAND',
      'MGET', 'MSET', 'MSETNX',
      'APPEND', 'STRLEN', 'GETRANGE', 'SETRANGE',
      'INCR', 'DECR', 'INCRBY', 'DECRBY', 'INCRBYFLOAT',
      'SETNX', 'SETEX', 'PSETEX', 'GETSET', 'GETDEL', 'GETEX',
      'RENAME', 'RENAMENX', 'TYPE', 'DBSIZE', 'COPY', 'RANDOMKEY', 'UNLINK', 'TOUCH', 'SCAN',
      'EXPIRE', 'EXPIREAT', 'PEXPIRE', 'PEXPIREAT', 'TTL', 'PTTL', 'PERSIST', 'EXPIRETIME', 'PEXPIRETIME',
      'ECHO', 'QUIT',
      'LCS',
      'HSET', 'HGET', 'HDEL', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS',
      'HSETNX', 'HMSET', 'HMGET', 'HINCRBY', 'HINCRBYFLOAT', 'HRANDFIELD', 'HSCAN',
      'HSTRLEN', 'HGETDEL', 'HGETEX', 'HSETEX',
      'HEXPIRE', 'HEXPIREAT', 'HPEXPIRE', 'HPEXPIREAT', 'HEXPIRETIME', 'HPEXPIRETIME',
      'HPERSIST', 'HTTL', 'HPTTL',
      'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LLEN', 'LRANGE', 'LINDEX',
      'LSET', 'LREM', 'LTRIM', 'LPOS', 'RPOPLPUSH', 'LPUSHX', 'RPUSHX',
      'LINSERT', 'LMOVE', 'BLPOP', 'BRPOP', 'BRPOPLPUSH', 'BLMOVE', 'LMPOP',
    ];
    return encodeArray(commands);
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
}