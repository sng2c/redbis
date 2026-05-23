import * as net from 'net';
import type { IStorage } from '../storage/interface';
import { PubSubManager } from '../pubsub/manager';
import { CommandHandler } from '../command/handler';
import { RespParser } from '../protocol/parser';
import { createLogger } from '../logger';

const logger = createLogger('connection');

export class ConnectionManager {
  private activeSockets = new Set<net.Socket>();
  private connectionCounter = 0;

  get activeConnectionCount(): number {
    return this.activeSockets.size;
  }

  addSocket(socket: net.Socket): number {
    this.activeSockets.add(socket);
    return ++this.connectionCounter;
  }

  removeSocket(socket: net.Socket): void {
    this.activeSockets.delete(socket);
  }
}

const defaultManager = new ConnectionManager();

export function getActiveConnectionCount(): number {
  return defaultManager.activeConnectionCount;
}

export function createConnectionHandler(
  storage: IStorage,
  pubsub: PubSubManager,
  manager: ConnectionManager = defaultManager
): (socket: net.Socket) => void {
  return function handleConnection(socket: net.Socket): void {
    manager.addSocket(socket);
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    const remotePort = socket.remotePort ?? 0;
    const clientId = `${remoteAddress}:${remotePort}`;
    const connId = `conn-${manager.activeConnectionCount}`;

    logger.info('Client connected', { clientId, activeConnections: manager.activeConnectionCount });

    const send = (msg: string) => {
      socket.write(msg);
    };
    const handler = new CommandHandler(storage, pubsub, connId, send);
    const parser = new RespParser();

    socket.setTimeout(300000);
    socket.on('timeout', () => {
      logger.warn('Socket timeout', { clientId });
      socket.destroy();
    });

    socket.on('data', (data: Buffer) => {
      parser.feed(data);
      let parsed: string[] | null;
      while ((parsed = parser.parse()) !== null) {
        handler
          .execute(parsed)
          .then((response: string) => {
            socket.write(response);
          })
          .catch((err: Error) => {
            logger.error('Command execution error', { clientId, error: err.message });
          });
      }
    });

    socket.on('close', () => {
      handler.destroy();
      manager.removeSocket(socket);
      logger.info('Client disconnected', {
        clientId,
        activeConnections: manager.activeConnectionCount,
      });
    });

    socket.on('error', (err: Error) => {
      logger.error('Socket error', { clientId, error: err.message });
    });
  };
}
