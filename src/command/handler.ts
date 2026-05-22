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

        default:
          return encodeError(`unknown command '${args[0]}'`);
      }
    } catch (e: any) {
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
}