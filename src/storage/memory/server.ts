// @ts-nocheck
import type { InMemoryStorage } from './core';
import { formatMemoryHuman } from './types';

export const serverMethods = {
async save(): Promise<void> {
    // No-op for in-memory storage
  },

async bgsave(): Promise<string> {
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

    // Memory section — estimate total bytes of all stored data
    let usedMemory = 0;
    for (const [key, entry] of this.store) {
      usedMemory += key.length + entry.value.length;
    }
    for (const [key, fields] of this.hashStore) {
      usedMemory += key.length;
      for (const [field, fentry] of fields) {
        usedMemory += field.length + fentry.value.length;
      }
    }
    for (const [key, list] of this.listStore) {
      usedMemory += key.length;
      for (const val of list) {
        usedMemory += val.length;
      }
    }
    for (const [key, set] of this.setStore) {
      usedMemory += key.length;
      for (const member of set) {
        usedMemory += member.length;
      }
    }
    for (const [key, zset] of this.zsetStore) {
      usedMemory += key.length;
      for (const [member] of zset) {
        usedMemory += member.length;
      }
    }
    const usedMemoryHuman = formatMemoryHuman(usedMemory);
    sections['memory'] =
      '# Memory\r\n' +
      'used_memory:' + usedMemory + '\r\n' +
      'used_memory_human:' + usedMemoryHuman + '\r\n';

    // Persistence section
    sections['persistence'] =
      '# Persistence\r\n' +
      'loading:0\r\n' +
      'rdb_last_save_time:0\r\n';

    // Keyspace section
    sections['keyspace'] =
      '# Keyspace\r\n' +
      'db0:keys=' + this.store.size + ',expires=0\r\n';

    if (section && section !== 'all') {
      return sections[section] ?? '';
    }
    // Return all sections
    return sections['server'] + sections['clients'] + sections['memory'] + sections['persistence'] + sections['keyspace'];
  },

async getLastSaveTime(): Promise<number> {
    return 0;
  },

};
