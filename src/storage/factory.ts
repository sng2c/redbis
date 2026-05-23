import type { Config } from '../config';
import type { IStorage } from './interface';
import { InMemoryStorage } from './memory';
import { SqliteStorage } from './sqlite';

export type ParsedConnectionString = { type: 'memory' } | { type: 'sqlite'; path: string };

export function parseConnectionString(url: string): ParsedConnectionString {
  const separatorIndex = url.indexOf('://');
  if (separatorIndex === -1) {
    throw new Error(`Unsupported connection string scheme: ${url}`);
  }

  const scheme = url.substring(0, separatorIndex);
  const rest = url.substring(separatorIndex + 3); // after "://"

  if (scheme === 'memory') {
    return { type: 'memory' };
  }

  if (scheme === 'sqlite') {
    // sqlite://./data/redbis.db → path = ./data/redbis.db (relative)
    // sqlite:///var/data/db    → path = /var/data/db (absolute, rest starts with /)
    const path = rest.startsWith('/') ? rest : rest;
    return { type: 'sqlite', path };
  }

  throw new Error(`Unsupported connection string scheme: ${scheme}`);
}

export function createStorage(cfg: Config): IStorage {
  const info = parseConnectionString(cfg.databaseUrl);

  switch (info.type) {
    case 'memory':
      return new InMemoryStorage();
    case 'sqlite':
      return new SqliteStorage({ path: info.path });
    default:
      throw new Error(`Unsupported storage type: ${(info as ParsedConnectionString).type}`);
  }
}
