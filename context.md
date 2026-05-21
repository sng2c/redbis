# Redbis Source Recon

## src/storage/interface.ts
```ts
export interface IStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  flush(): Promise<void>;
}

export interface StorageConfig {
  path: string;
}
```

## src/storage/sqlite.ts
```ts
import { IStorage } from './interface';

export class SqliteStorage implements IStorage {
  async get(_key: string): Promise<string | null> {
    throw new Error('Not implemented: SqliteStorage.get');
  }
  async set(_key: string, _value: string): Promise<void> {
    throw new Error('Not implemented: SqliteStorage.set');
  }
  async delete(_key: string): Promise<boolean> {
    throw new Error('Not implemented: SqliteStorage.delete');
  }
  async keys(_pattern: string): Promise<string[]> {
    throw new Error('Not implemented: SqliteStorage.keys');
  }
  async flush(): Promise<void> {
    throw new Error('Not implemented: SqliteStorage.flush');
  }
}
```

## src/server/connection.ts
```ts
import * as net from 'net';
import { InMemoryStorage } from '../storage/memory';
import { CommandHandler } from '../command/handler';
import { RespParser } from '../protocol/parser';
import { createLogger } from '../logger';

const logger = createLogger('connection');
const storage = new InMemoryStorage();
const activeSockets = new Set<net.Socket>();

export function getActiveConnectionCount(): number {
  return activeSockets.size;
}

export function handleConnection(socket: net.Socket): void {
  activeSockets.add(socket);
  const remoteAddress = socket.remoteAddress ?? 'unknown';
  const remotePort = socket.remotePort ?? 0;
  const clientId = `${remoteAddress}:${remotePort}`;
  logger.info('Client connected', { clientId, activeConnections: activeSockets.size });

  const handler = new CommandHandler(storage);
  const parser = new RespParser();

  socket.setTimeout(300000);
  socket.on('timeout', () => { logger.warn('Socket timeout', { clientId }); socket.destroy(); });

  socket.on('data', (data: Buffer) => {
    parser.feed(data);
    let parsed: string[] | null;
    while ((parsed = parser.parse()) !== null) {
      handler.execute(parsed).then((response: string) => {
        socket.write(response);
      }).catch((err: Error) => {
        logger.error('Command execution error', { clientId, error: err.message });
      });
    }
  });

  socket.on('close', () => {
    activeSockets.delete(socket);
    logger.info('Client disconnected', { clientId, activeConnections: activeSockets.size });
  });
  socket.on('error', (err: Error) => {
    logger.error('Socket error', { clientId, error: err.message });
  });
}
```

## src/command/handler.ts
```ts
import { IStorage } from '../storage/interface';
import { encodeSimpleString, encodeError, encodeInteger, encodeBulkString, encodeArray } from '../protocol/resp';

export class CommandHandler {
  private storage: IStorage;
  constructor(storage: IStorage) { this.storage = storage; }

  async execute(args: string[]): Promise<string> {
    if (args.length === 0) return encodeError('unknown command');
    const command = args[0].toUpperCase();
    switch (command) {
      case 'PING':    return this.ping(args.slice(1));
      case 'SET':     return this.set(args.slice(1));
      case 'GET':     return this.get(args.slice(1));
      case 'DEL':     return this.del(args.slice(1));
      case 'KEYS':    return this.keys(args.slice(1));
      case 'EXISTS':  return this.exists(args.slice(1));
      case 'FLUSHDB': return this.flushdb();
      case 'COMMAND': return this.command();
      default:        return encodeError(`unknown command '${args[0]}'`);
    }
  }

  private ping(args: string[]): string {
    return args.length === 0 ? encodeSimpleString('PONG') : encodeBulkString(args[0]);
  }
  private async set(args: string[]): Promise<string> {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SET' command");
    await this.storage.set(args[0], args[1]);
    return encodeSimpleString('OK');
  }
  private async get(args: string[]): Promise<string> {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'GET' command");
    return encodeBulkString(await this.storage.get(args[0]));
  }
  private async del(args: string[]): Promise<string> {
    if (args.length === 0) return encodeError("wrong number of arguments for 'DEL' command");
    let count = 0;
    for (const key of args) { if (await this.storage.delete(key)) count++; }
    return encodeInteger(count);
  }
  private async keys(args: string[]): Promise<string> {
    if (args.length === 0) return encodeError("wrong number of arguments for 'KEYS' command");
    return encodeArray(await this.storage.keys(args[0]));
  }
  private async exists(args: string[]): Promise<string> {
    if (args.length === 0) return encodeError("wrong number of arguments for 'EXISTS' command");
    let count = 0;
    for (const key of args) { if ((await this.storage.get(key)) !== null) count++; }
    return encodeInteger(count);
  }
  private async flushdb(): Promise<string> {
    await this.storage.flush();
    return encodeSimpleString('OK');
  }
  private command(): string {
    return encodeArray(['PING', 'SET', 'GET', 'DEL', 'KEYS', 'EXISTS', 'FLUSHDB', 'COMMAND']);
  }
}
```

## src/server/index.ts
```ts
import * as net from 'net';
import { Config } from '../config';
import { handleConnection } from './connection';
import { createLogger } from '../logger';

const logger = createLogger('server');

export function createServer(config: Config): net.Server {
  return net.createServer((socket: net.Socket) => { handleConnection(socket); });
}

export function startServer(config: Config): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(config);
    server.on('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      logger.info('Server started', { host: config.host, port: (server.address() as any)?.port ?? config.port });
      resolve(server);
    });
  });
}

export function shutdownServer(server: net.Server, timeout: number = 5000): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    logger.info('Server shutdown initiated');
    server.close(() => { logger.info('Server closed'); done(); });
    setTimeout(() => {
      logger.warn('Shutdown timeout - forcing close', { timeout });
      if (typeof (server as any).closeAllConnections === 'function') (server as any).closeAllConnections();
      done();
    }, timeout);
  });
}
```

## src/index.ts
```ts
import { config, loadConfig } from './config';
import { createLogger } from './logger';
import { startServer, shutdownServer } from './server';
import * as net from 'net';

const logger = createLogger('main');

async function main(): Promise<void> {
  const appConfig = loadConfig();
  logger.info('설정을 로드했습니다', { port: appConfig.port, host: appConfig.host, logLevel: appConfig.logLevel });
  let server: net.Server;
  try { server = await startServer(appConfig); }
  catch (err) { logger.error('서버 시작 실패', { error: err instanceof Error ? err.message : String(err) }); process.exit(1); }

  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info('종료 시그널 수신', { signal });
    try { await shutdownServer(server, 5000); }
    catch (err) { logger.error('서버 종료 중 에러 발생', { error: err instanceof Error ? err.message : String(err) }); }
    logger.info('Redbis 서버가 종료되었습니다');
    process.exit(0);
  };
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
main();
```

## src/__tests__/sqlite.test.ts
All 6 tests verify `SqliteStorage` stub methods throw `'Not implemented: SqliteStorage.<method>'`. One test confirms instantiation. No real storage logic — placeholder only.

## src/__tests__/command.test.ts
Tests `CommandHandler` with `InMemoryStorage`: PING (no args → `+PONG\r\n`, args → bulk string, lowercase ok), SET (`+OK\r\n`, arg count error), GET (bulk string / null `$-1\r\n` / arg errors), DEL (integer count, multi-key, no-args error), KEYS (`*`/prefix`h*`/`?` wildcard, no-match `*0\r\n`, no-args error), EXISTS (integer count, no-args error), FLUSHDB (`+OK\r\n`), COMMAND (array of 8 command names), unknown command (preserves case in error), empty args (`-ERR unknown command\r\n`).

## src/__tests__/connection.test.ts
Tests `handleConnection` + `getActiveConnectionCount()`: connection increments count, disconnection decrements, 3 simultaneous clients tracked. Uses real TCP server with `beforeEach`/`afterEach` lifecycle, 100-150ms delays for async propagation.

## src/__tests__/implementation.test.ts
```ts
import { describe, it, expect } from 'vitest';
describe('implementation', () => {
  it.todo('integration tests to be added');
});
```

## src/__tests__/memory-storage.test.ts
Tests `InMemoryStorage`: get (null→missing, value→existing), set (store/overwrite/multi), delete (true→existing+removal, false→missing), keys (`*` all, `user:*` prefix, `?` single char, empty→`[]`, no-match→`[]`), flush (clears all data, keys→`[]` after flush).