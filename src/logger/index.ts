// 구조화된 JSON 로거 모듈
// 각 모듈/컨텍스트별로 로거를 생성할 수 있으며,
// ISO 타임스탬프, 로그 레벨, 모듈명, 메시지를 JSON 형태로 출력합니다.

import { config, isLogLevelEnabled } from '../config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private readonly module: string;

  constructor(moduleName: string) {
    this.module = moduleName;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!isLogLevelEnabled(config.logLevel, level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
    };

    if (data !== undefined && Object.keys(data).length > 0) {
      entry.data = data;
    }

    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }
}

// 모듈별 로거를 생성하는 팩토리 함수
export function createLogger(module: string): Logger {
  return new Logger(module);
}