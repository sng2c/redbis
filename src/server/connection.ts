import * as net from 'net';
import type { IStorage } from '../storage/interface';
import { PubSubManager } from '../pubsub/manager';
import { CommandHandler } from '../command/handler';
import { RespParser } from '../protocol/parser';
import { createLogger } from '../logger';

const logger = createLogger('connection');
const activeSockets = new Set<net.Socket>();
let connectionCounter = 0;

export function getActiveConnectionCount(): number {
  return activeSockets.size;
}

export function createConnectionHandler(storage: IStorage, pubsub: PubSubManager): (socket: net.Socket) => void {
  return function handleConnection(socket: net.Socket): void {
    activeSockets.add(socket);
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    const remotePort = socket.remotePort ?? 0;
    const clientId = `${remoteAddress}:${remotePort}`;
    const connId = `conn-${++connectionCounter}`;

    logger.info('Client connected', { clientId, activeConnections: activeSockets.size });

    const send = (msg: string) => { socket.write(msg); };
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
        handler.execute(parsed).then((response: string) => {
          socket.write(response);
        }).catch((err: Error) => {
          logger.error('Command execution error', { clientId, error: err.message });
        });
      }
    });

    socket.on('close', () => {
      handler.destroy();
      activeSockets.delete(socket);
      logger.info('Client disconnected', { clientId, activeConnections: activeSockets.size });
    });

    socket.on('error', (err: Error) => {
      logger.error('Socket error', { clientId, error: err.message });
    });
  };
}