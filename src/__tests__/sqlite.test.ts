import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../storage/sqlite';

describe('SqliteStorage', () => {
  let storage: SqliteStorage;

  beforeEach(() => {
    storage = new SqliteStorage();
  });

  it('SqliteStorage 인스턴스를 생성할 수 있다', () => {
    expect(storage).toBeInstanceOf(SqliteStorage);
  });

  it('get 메서드가 구현되지 않음 에러를 발생시킨다', async () => {
    await expect(storage.get('key')).rejects.toThrow('Not implemented: SqliteStorage.get');
  });

  it('set 메서드가 구현되지 않음 에러를 발생시킨다', async () => {
    await expect(storage.set('key', 'value')).rejects.toThrow('Not implemented: SqliteStorage.set');
  });

  it('delete 메서드가 구현되지 않음 에러를 발생시킨다', async () => {
    await expect(storage.delete('key')).rejects.toThrow('Not implemented: SqliteStorage.delete');
  });

  it('keys 메서드가 구현되지 않음 에러를 발생시킨다', async () => {
    await expect(storage.keys('*')).rejects.toThrow('Not implemented: SqliteStorage.keys');
  });

  it('flush 메서드가 구현되지 않음 에러를 발생시킨다', async () => {
    await expect(storage.flush()).rejects.toThrow('Not implemented: SqliteStorage.flush');
  });
});