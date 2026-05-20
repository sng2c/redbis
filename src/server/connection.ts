// 클라이언트 연결 핸들러 모듈
// 각 클라이언트 소켓 연결에 대해 데이터 수신, 에러 처리, 연결 종료를 관리합니다.
// 클라이언트 연결 해제 시에도 서버가 계속 동작하도록 안전하게 처리합니다.

import * as net from 'net';
import { createLogger } from '../logger';

const logger = createLogger('connection');

// 현재 활성 연결 수를 추적하는 카운터
let activeConnections = 0;

export function getActiveConnectionCount(): number {
  return activeConnections;
}

export function handleConnection(socket: net.Socket): void {
  const remoteAddress = socket.remoteAddress ?? 'unknown';
  const remotePort = socket.remotePort ?? 0;
  const clientId = `${remoteAddress}:${remotePort}`;

  activeConnections++;
  logger.info('새 클라이언트 연결', {
    clientId,
    activeConnections,
  });

  // 소켓 에러 핸들러 - 프로세스가 죽지 않도록 반드시 처리해야 함
  socket.on('error', (err: Error) => {
    logger.error('소켓 에러 발생', {
      clientId,
      error: err.message,
    });
  });

  // 데이터 수신 핸들러 - 수신된 원시 데이터를 로그에 기록
  socket.on('data', (data: Buffer) => {
    logger.debug('수신 데이터', {
      clientId,
      bytes: data.length,
      data: data.toString('utf8'),
    });
  });

  // 연결 종료 핸들러
  socket.on('close', (hadError: boolean) => {
    activeConnections--;
    logger.info('클라이언트 연결 종료', {
      clientId,
      hadError,
      activeConnections,
    });
  });

  // 소켓 타임아웃 설정 (유휴 연결 관리)
  socket.setTimeout(300000, () => {
    logger.warn('소켓 타임아웃 발생', { clientId });
    socket.destroy();
  });
}