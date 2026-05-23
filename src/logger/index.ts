import { config, isLogLevelEnabled } from '../config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

export class Logger {
  private readonly module: string;

  constructor(moduleName: string) {
    this.module = moduleName;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!isLogLevelEnabled(config.logLevel, level)) {
      return;
    }
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
    };
    if (
      data !== undefined &&
      !(
        typeof data === 'object' &&
        data !== null &&
        Object.keys(data as Record<string, unknown>).length === 0
      )
    ) {
      entry.data = data;
    }
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  public debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  public info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  public warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  public error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
