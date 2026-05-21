import * as net from 'net';
import { Config } from '../config';
import type { IStorage } from '../storage/interface';
import { createConnectionHandler } from './connection';
import { createLogger } from '../logger';

const logger = createLogger('server');

export function createServer(config: Config, storage: IStorage): net.Server {
  const connectionHandler = createConnectionHandler(storage);
  return net.createServer((socket: net.Socket) => {
    connectionHandler(socket);
  });
}

export function startServer(config: Config, storage: IStorage): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(config, storage);

    const onError = (err: Error) => {
      reject(err);
    };

    server.on('error', onError);

    server.listen(config.port, config.host, () => {
      server.removeListener('error', onError);
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : config.port;
      logger.info('Server started', { host: config.host, port });
      resolve(server);
    });
  });
}

export function shutdownServer(server: net.Server, timeout: number = 5000): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;

    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    logger.info('Server shutdown initiated');

    server.close(() => {
      logger.info('Server closed');
      done();
    });

    const timer = setTimeout(() => {
      logger.warn('Shutdown timeout - forcing close', { timeout });
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      done();
    }, timeout);
  });
}