// TCP 서버 모듈
// net.Server를 생성하고, 클라이언트 연결을 connection 핸들러에 위임합니다.
// 서버 시작 및 우아한 종료(graceful shutdown) 로직을 제공합니다.

import * as net from 'net';
import { Config } from '../config';
import { createLogger } from '../logger';
import { handleConnection } from './connection';

const logger = createLogger('server');

// TCP 서버를 생성합니다.
export function createServer(config: Config): net.Server {
  const server = net.createServer((socket: net.Socket) => {
    handleConnection(socket);
  });

  // 서버 수신 대기 에러 처리 (포트 충돌 등)
  server.on('error', (err: Error) => {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      logger.error('포트가 이미 사용 중입니다', {
        port: config.port,
        host: config.host,
      });
    } else {
      logger.error('서버 에러 발생', {
        error: err.message,
      });
    }
  });

  return server;
}

// 서버를 시작하고 수신 대기 상태로 만듭니다.
export function startServer(config: Config): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(config);

    server.on('error', (err: Error) => {
      reject(err);
    });

    server.listen(config.port, config.host, () => {
      logger.info('Redbis 서버가 시작되었습니다', {
        host: config.host,
        port: config.port,
        logLevel: config.logLevel,
      });
      resolve(server);
    });
  });
}

// 우아한 종료 - 새로운 연결을 거부하고 기존 연결을 정상적으로 종료합니다.
// timeout 밀리초 내에 종료되지 않으면 강제 종료합니다.
export function shutdownServer(server: net.Server, timeout: number = 5000): Promise<void> {
  return new Promise((resolve) => {
    const forceExitTimer = setTimeout(() => {
      logger.warn('우아한 종료 타임아웃 - 강제 종료', { timeout });
      resolve();
    }, timeout);

    logger.info('서버 종료 시작 - 새로운 연결을 거부합니다');

    server.close(() => {
      clearTimeout(forceExitTimer);
      logger.info('모든 연결이 종료되었습니다');
      resolve();
    });
  });
}