import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHandler } from '../command/handler';
import { InMemoryStorage } from '../storage/memory';
import { PubSubManager } from '../pubsub/manager';

describe('DELEX 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  describe('DELEX 기본', () => {
    it('DELEX with no conditions on existing key deletes and returns 1', async () => {
      await handler.execute(['SET', 'mykey', 'hello']);
      const result = await handler.execute(['DELEX', 'mykey']);
      expect(result).toBe(':1\r\n');
    });

    it('DELEX with no conditions on non-existent key returns 0', async () => {
      const result = await handler.execute(['DELEX', 'nonexist']);
      expect(result).toBe(':0\r\n');
    });

    it('DELEX IF EQU matching value deletes key', async () => {
      await handler.execute(['SET', 'mykey', 'hello']);
      const result = await handler.execute(['DELEX', 'mykey', 'IF', 'EQU', 'hello']);
      expect(result).toBe(':1\r\n');
    });

    it('DELEX IF EQU wrong value does not delete', async () => {
      await handler.execute(['SET', 'mykey', 'hello']);
      const result = await handler.execute(['DELEX', 'mykey', 'IF', 'EQU', 'wrong']);
      expect(result).toBe(':0\r\n');
    });

    it('DELEX IF NEQ different value deletes key', async () => {
      await handler.execute(['SET', 'mykey', 'hello']);
      const result = await handler.execute(['DELEX', 'mykey', 'IF', 'NEQ', 'world']);
      expect(result).toBe(':1\r\n');
    });

    it('DELEX IF NEQ same value does not delete', async () => {
      await handler.execute(['SET', 'mykey', 'hello']);
      const result = await handler.execute(['DELEX', 'mykey', 'IF', 'NEQ', 'hello']);
      expect(result).toBe(':0\r\n');
    });

    it('DELEX IF GT with larger value deletes key', async () => {
      await handler.execute(['SET', 'mykey', '10']);
      const result = await handler.execute(['DELEX', 'mykey', 'IF', 'GT', '5']);
      expect(result).toBe(':1\r\n');
    });

    it('DELEX IF LT with smaller value deletes key', async () => {
      await handler.execute(['SET', 'mykey', '3']);
      const result = await handler.execute(['DELEX', 'mykey', 'IF', 'LT', '5']);
      expect(result).toBe(':1\r\n');
    });

    it('DELEX IF GE and IF LE boundary conditions', async () => {
      await handler.execute(['SET', 'mykey', '5']);
      const result = await handler.execute(['DELEX', 'mykey', 'IF', 'GE', '5', 'IF', 'LE', '5']);
      expect(result).toBe(':1\r\n');
    });

    it('DELEX with multiple conditions (AND logic)', async () => {
      await handler.execute(['SET', 'mykey', '10']);
      const result = await handler.execute(['DELEX', 'mykey', 'IF', 'GT', '5', 'IF', 'LT', '20']);
      expect(result).toBe(':1\r\n');
    });

    it('DELEX with non-existent key returns 0 even with conditions', async () => {
      const result = await handler.execute(['DELEX', 'nonexist', 'IF', 'EQU', 'hello']);
      expect(result).toBe(':0\r\n');
    });
  });
});

describe('MSETEX 명령어 — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  it('MSETEX sets single key with TTL', async () => {
    const result = await handler.execute(['MSETEX', 'mykey', '60', 'hello']);
    expect(result).toBe(':1\r\n');
    const val = await handler.execute(['GET', 'mykey']);
    expect(val).toBe('$5\r\nhello\r\n');
  });

  it('MSETEX sets multiple keys with TTL', async () => {
    const result = await handler.execute(['MSETEX', 'key1', '60', 'val1', 'key2', '120', 'val2']);
    expect(result).toBe(':2\r\n');
    const v1 = await handler.execute(['GET', 'key1']);
    const v2 = await handler.execute(['GET', 'key2']);
    expect(v1).toBe('$4\r\nval1\r\n');
    expect(v2).toBe('$4\r\nval2\r\n');
  });

  it('MSETEX with wrong number of args returns error', async () => {
    const result = await handler.execute(['MSETEX', 'key1', '60']);
    expect(result).toContain('ERR');
  });
});

describe('BGSAVE / AUTH / HELLO / RESET / SELECT / CLIENT — InMemoryStorage', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    const storage = new InMemoryStorage();
    handler = new CommandHandler(storage, new PubSubManager(), 'test-conn', () => {});
  });

  it('BGSAVE returns OK', async () => {
    const result = await handler.execute(['BGSAVE']);
    expect(result).toBe('+OK\r\n');
  });

  it('AUTH with password returns OK', async () => {
    const result = await handler.execute(['AUTH', 'mypassword']);
    expect(result).toBe('+OK\r\n');
  });

  it('AUTH with username and password returns OK', async () => {
    const result = await handler.execute(['AUTH', 'user', 'pass']);
    expect(result).toBe('+OK\r\n');
  });

  it('HELLO returns server info', async () => {
    const result = await handler.execute(['HELLO']);
    expect(result).toContain('redbis');
  });

  it('RESET clears MULTI state', async () => {
    await handler.execute(['MULTI']);
    const result = await handler.execute(['RESET']);
    expect(result).toBe('+RESET\r\n');
    // After RESET, EXEC should fail (not in MULTI)
    const execResult = await handler.execute(['EXEC']);
    expect(execResult).toContain('ERR');
  });

  it('SELECT returns OK', async () => {
    const result = await handler.execute(['SELECT', '0']);
    expect(result).toBe('+OK\r\n');
  });

  it('CLIENT SETNAME and GETNAME', async () => {
    const setResult = await handler.execute(['CLIENT', 'SETNAME', 'myclient']);
    expect(setResult).toBe('+OK\r\n');
    const getNameResult = await handler.execute(['CLIENT', 'GETNAME']);
    expect(getNameResult).toBe('$8\r\nmyclient\r\n');
  });

  it('CLIENT ID returns integer', async () => {
    const result = await handler.execute(['CLIENT', 'ID']);
    expect(result).toMatch(/^:\d+\r\n$/);
  });

  it('CLIENT KILL returns OK', async () => {
    const result = await handler.execute(['CLIENT', 'KILL', 'addr:1234']);
    expect(result).toBe('+OK\r\n');
  });

  it('CLIENT LIST returns bulk string', async () => {
    const result = await handler.execute(['CLIENT', 'LIST']);
    expect(result).toMatch(/^\$/);
  });

  it('CLIENT PAUSE and UNPAUSE return OK', async () => {
    expect(await handler.execute(['CLIENT', 'PAUSE', '1000'])).toBe('+OK\r\n');
    expect(await handler.execute(['CLIENT', 'UNPAUSE'])).toBe('+OK\r\n');
  });

  it('CLIENT UNBLOCK returns 0', async () => {
    const result = await handler.execute(['CLIENT', 'UNBLOCK', '1']);
    expect(result).toBe(':0\r\n');
  });

  it('CLIENT REPLY returns OK', async () => {
    expect(await handler.execute(['CLIENT', 'REPLY', 'ON'])).toBe('+OK\r\n');
  });

  it('CLIENT SETINFO returns OK', async () => {
    const result = await handler.execute(['CLIENT', 'SETINFO', 'LIB-NAME', 'redbis-client']);
    expect(result).toBe('+OK\r\n');
  });

  it('CONFIG RESETSTAT returns OK', async () => {
    const result = await handler.execute(['CONFIG', 'RESETSTAT']);
    expect(result).toBe('+OK\r\n');
  });

  it('CONFIG REWRITE returns error', async () => {
    const result = await handler.execute(['CONFIG', 'REWRITE']);
    expect(result).toContain('ERR');
  });
});