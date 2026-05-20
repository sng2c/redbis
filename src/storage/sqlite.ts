// SQLite 스토리지 어댑터 스텁
// Phase 2에서 실제 SQLite 연동을 구현할 예정입니다.
// 현재는 IStorage 인터페이스를 구현하되 모든 메서드가
// "Not implemented" 에러를 발생시킵니다.

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