export interface SlowLogEntry {
  timestamp: number;
  command: string[];
  duration: number;
  id: number;
}

export const slowLog: SlowLogEntry[] = [];
export let slowLogId = 0;
export const SLOWLOG_MAX = 128;
export const SLOWLOG_SLOW_THRESHOLD = 10; // ms

export function recordSlowLog(command: string[], duration: number): void {
  if (duration >= SLOWLOG_SLOW_THRESHOLD) {
    if (slowLog.length >= SLOWLOG_MAX) slowLog.shift();
    slowLog.push({ timestamp: Date.now(), command, duration, id: ++slowLogId });
  }
}