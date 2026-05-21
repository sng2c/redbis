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

    switch (command) {
      case 'PING':
        return this.ping(args.slice(1));
      case 'SET':
        return this.set(args.slice(1));
      case 'GET':
        return this.get(args.slice(1));
      case 'DEL':
        return this.del(args.slice(1));
      case 'KEYS':
        return this.keys(args.slice(1));
      case 'EXISTS':
        return this.exists(args.slice(1));
      case 'FLUSHDB':
        return this.flushdb();
      case 'COMMAND':
        return this.command();
      default:
        return encodeError(`unknown command '${args[0]}'`);
    }
  }

  private ping(args: string[]): string {
    if (args.length === 0) {
      return encodeSimpleString('PONG');
    }
    return encodeBulkString(args[0]);
  }

  private async set(args: string[]): Promise<string> {
    if (args.length < 2) {
      return encodeError("wrong number of arguments for 'SET' command");
    }
    await this.storage.set(args[0], args[1]);
    return encodeSimpleString('OK');
  }

  private async get(args: string[]): Promise<string> {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'GET' command");
    }
    const value = await this.storage.get(args[0]);
    return encodeBulkString(value);
  }

  private async del(args: string[]): Promise<string> {
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

  private async keys(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError("wrong number of arguments for 'KEYS' command");
    }
    const matchingKeys = await this.storage.keys(args[0]);
    return encodeArray(matchingKeys);
  }

  private async exists(args: string[]): Promise<string> {
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

  private async flushdb(): Promise<string> {
    await this.storage.flush();
    return encodeSimpleString('OK');
  }

  private command(): string {
    const commands = ['PING', 'SET', 'GET', 'DEL', 'KEYS', 'EXISTS', 'FLUSHDB', 'COMMAND'];
    return encodeArray(commands);
  }
}