export interface Config {
  port: number;
  host: string;
  logLevel: string;
  storageType: 'memory' | 'sqlite';
  storagePath: string;
}

export const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function parsePort(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('유효하지 않은 포트 번호');
  }
  return port;
}

export function parseLogLevel(value: string | undefined, defaultValue: string): string {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  if (!(normalized in LOG_LEVELS)) {
    throw new Error('유효하지 않은 로그 레벨');
  }
  return normalized;
}

export function loadConfig(): Config {
  const storageType = (process.env.STORAGE_TYPE ?? 'memory') as 'memory' | 'sqlite';
  const defaultPath = storageType === 'sqlite' ? './data/redbis.db' : ':memory:';
  return {
    port: parsePort(process.env.REDBIS_PORT, 6379),
    host: process.env.REDBIS_HOST ?? '127.0.0.1',
    logLevel: parseLogLevel(process.env.REDBIS_LOG_LEVEL, 'info'),
    storageType,
    storagePath: process.env.STORAGE_PATH ?? defaultPath,
  };
}

export function isLogLevelEnabled(configLevel: string, messageLevel: string): boolean {
  const configPriority = LOG_LEVELS[configLevel] ?? LOG_LEVELS.info;
  const messagePriority = LOG_LEVELS[messageLevel] ?? LOG_LEVELS.info;
  return messagePriority >= configPriority;
}

export const config: Config = loadConfig();