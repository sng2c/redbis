// @ts-nocheck
import type { SqliteStorage } from './core';
import { formatMemoryHuman } from './types';

export const serverMethods = {
async save(): Promise<void> {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.lastSaveTime = Math.floor(Date.now() / 1000);
  },

async bgsave(): Promise<string> {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.lastSaveTime = Math.floor(Date.now() / 1000);
    return 'OK';
  },

async info(section?: string): Promise<string> {
    const sections: Record<string, string> = {};

    // Server section
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    sections['server'] =
      '# Server\r\n' +
      'redis_version:7.0.0\r\n' +
      'redis_mode:standalone\r\n' +
      'os:Linux\r\n' +
      'tcp_port:6379\r\n' +
      'uptime_in_seconds:' + uptime + '\r\n';

    // Clients section
    sections['clients'] =
      '# Clients\r\n' +
      'connected_clients:0\r\n';

    // Memory section — estimate using page_count * page_size
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    const usedMemory = pageCount * pageSize;
    const usedMemoryHuman = formatMemoryHuman(usedMemory);
    sections['memory'] =
      '# Memory\r\n' +
      'used_memory:' + usedMemory + '\r\n' +
      'used_memory_human:' + usedMemoryHuman + '\r\n';

    // Persistence section
    sections['persistence'] =
      '# Persistence\r\n' +
      'loading:0\r\n' +
      'rdb_last_save_time:' + this.lastSaveTime + '\r\n';

    // Keyspace section
    const cntRow = this.db.prepare('SELECT COUNT(*) as cnt FROM kv_store').get() as { cnt: number };
    sections['keyspace'] =
      '# Keyspace\r\n' +
      'db0:keys=' + cntRow.cnt + ',expires=0\r\n';

    if (section && section !== 'all') {
      return sections[section] ?? '';
    }
    // Return all sections
    return sections['server'] + sections['clients'] + sections['memory'] + sections['persistence'] + sections['keyspace'];
  },

async getLastSaveTime(): Promise<number> {
    return this.lastSaveTime;
  },

};
