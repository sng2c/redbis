// Redbis 서버 진입점
// 설정을 로드하고 TCP 서버를 시작합니다.
// SIGINT/SIGTERM 시그널을 처리하여 우아한 종료를 수행합니다.

import { loadConfig } from './config';
import { createLogger } from './logger';
import { startServer, shutdownServer } from './server';
import { createStorage } from './storage/factory';
import * as net from 'net';

const logger = createLogger('main');

async function main(): Promise<void> {
  // 설정 로드 (환경변수 우선)
  const appConfig = loadConfig();
  logger.info('설정을 로드했습니다', {
    port: appConfig.port,
    host: appConfig.host,
    logLevel: appConfig.logLevel,
    databaseUrl: appConfig.databaseUrl,
  });

  // 스토리지 생성
  const storage = createStorage(appConfig);

  // 서버 시작
  let server: net.Server;
  try {
    server = await startServer(appConfig, storage);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('서버 시작 실패', { error: errorMsg });
    process.exit(1);
  }

  // 우아한 종료 핸들러
  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    logger.info('종료 시그널 수신', { signal });

    try {
      await shutdownServer(server, 5000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('서버 종료 중 에러 발생', { error: errorMsg });
    }

    logger.info('Redbis 서버가 종료되었습니다');
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main();