import type { Config } from '../config';
import type { IStorage } from './interface';
import { InMemoryStorage } from './memory';
import { SqliteStorage } from './sqlite';

export function createStorage(cfg: Config): IStorage {
  switch (cfg.storageType) {
    case 'memory':
      return new InMemoryStorage();
    case 'sqlite':
      return new SqliteStorage({ path: cfg.storagePath });
    default:
      throw new Error(`Unknown storage type: ${cfg.storageType}`);
  }
}