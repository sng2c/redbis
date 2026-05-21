import { IStorage } from './interface';

export class SqliteStorage implements IStorage {
  async get(_key: string): Promise<string | null> {
    throw new Error('Not implemented: SqliteStorage.get');
  }

  async set(_key: string, _value: string): Promise<void> {
    throw new Error('Not implemented: SqliteStorage.set');
  }

  async delete(_key: string): Promise<boolean> {
    throw new Error('Not implemented: SqliteStorage.delete');
  }

  async keys(_pattern: string): Promise<string[]> {
    throw new Error('Not implemented: SqliteStorage.keys');
  }

  async flush(): Promise<void> {
    throw new Error('Not implemented: SqliteStorage.flush');
  }
}