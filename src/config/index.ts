// 환경변수와 기본값을 관리하는 설정 모듈
// 포트, 호스트, 로그 레벨을 환경변수에서 읽어오며 기본값을 제공합니다.

export interface Config {
  port: number;
  host: string;
  logLevel: string;
}

// 로그 레벨 우선순위 (낮을수록 더 많은 로그 출력)
const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parsePort(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`유효하지 않은 포트 번호: ${value}`);
  }
  return parsed;
}

function parseLogLevel(value: string | undefined, defaultValue: string): string {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  if (!(normalized in LOG_LEVELS)) {
    throw new Error(`유효하지 않은 로그 레벨: ${value}. 사용 가능: debug, info, warn, error`);
  }
  return normalized;
}

export function loadConfig(): Config {
  return {
    port: parsePort(process.env.REDBIS_PORT, 6379),
    host: process.env.REDBIS_HOST ?? '127.0.0.1',
    logLevel: parseLogLevel(process.env.REDBIS_LOG_LEVEL, 'info'),
  };
}

export function isLogLevelEnabled(configLevel: string, messageLevel: string): boolean {
  const configPriority = LOG_LEVELS[configLevel] ?? LOG_LEVELS.info;
  const messagePriority = LOG_LEVELS[messageLevel] ?? LOG_LEVELS.info;
  return messagePriority >= configPriority;
}

// 싱글톤 설정 객체
export const config: Config = loadConfig();