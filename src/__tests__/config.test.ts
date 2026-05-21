import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, isLogLevelEnabled, parsePort, parseLogLevel } from '../config';
import { createStorage } from '../storage/factory';
import { InMemoryStorage } from '../storage/memory';
import { SqliteStorage } from '../storage/sqlite';

describe('loadConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('환경변수가 없을 때 기본값을 반환한다', () => {
    vi.stubEnv('REDBIS_PORT', '');
    vi.stubEnv('REDBIS_HOST', '');
    vi.stubEnv('REDBIS_LOG_LEVEL', '');
    // Delete the env vars so they are undefined
    delete process.env.REDBIS_PORT;
    delete process.env.REDBIS_HOST;
    delete process.env.REDBIS_LOG_LEVEL;

    const cfg = loadConfig();
    expect(cfg).toEqual({
      port: 6379,
      host: '127.0.0.1',
      logLevel: 'info',
      storageType: 'memory',
      storagePath: ':memory:',
    });
  });

  it('REDBIS_PORT 환경변수로 포트를 설정할 수 있다', () => {
    vi.stubEnv('REDBIS_PORT', '6380');
    const cfg = loadConfig();
    expect(cfg.port).toBe(6380);
  });

  it('REDBIS_HOST 환경변수로 호스트를 설정할 수 있다', () => {
    vi.stubEnv('REDBIS_HOST', '0.0.0.0');
    const cfg = loadConfig();
    expect(cfg.host).toBe('0.0.0.0');
  });

  it('REDBIS_LOG_LEVEL 환경변수로 로그 레벨을 설정할 수 있다', () => {
    vi.stubEnv('REDBIS_LOG_LEVEL', 'debug');
    const cfg = loadConfig();
    expect(cfg.logLevel).toBe('debug');
  });

  it('REDBIS_LOG_LEVEL이 대문자여도 소문자로 정규화된다', () => {
    vi.stubEnv('REDBIS_LOG_LEVEL', 'DEBUG');
    const cfg = loadConfig();
    expect(cfg.logLevel).toBe('debug');
  });

  it('유효하지 않은 포트 번호일 때 에러를 발생시킨다', () => {
    // NaN
    vi.stubEnv('REDBIS_PORT', 'abc');
    expect(() => loadConfig()).toThrow('유효하지 않은 포트 번호');

    vi.unstubAllEnvs();

    // Too low (0)
    vi.stubEnv('REDBIS_PORT', '0');
    expect(() => loadConfig()).toThrow('유효하지 않은 포트 번호');

    vi.unstubAllEnvs();

    // Too high (70000)
    vi.stubEnv('REDBIS_PORT', '70000');
    expect(() => loadConfig()).toThrow('유효하지 않은 포트 번호');

    vi.unstubAllEnvs();

    // Negative
    vi.stubEnv('REDBIS_PORT', '-1');
    expect(() => loadConfig()).toThrow('유효하지 않은 포트 번호');
  });

  it('유효하지 않은 로그 레벨일 때 에러를 발생시킨다', () => {
    vi.stubEnv('REDBIS_LOG_LEVEL', 'invalid');
    expect(() => loadConfig()).toThrow('유효하지 않은 로그 레벨');
  });

  it('경계값 포트 번호가 허용된다', () => {
    vi.stubEnv('REDBIS_PORT', '1');
    expect(loadConfig().port).toBe(1);

    vi.unstubAllEnvs();

    vi.stubEnv('REDBIS_PORT', '65535');
    expect(loadConfig().port).toBe(65535);
  });
});

describe('isLogLevelEnabled', () => {
  it('config 레벨보다 높은 우선순위 메시지 레벨은 활성화된다', () => {
    expect(isLogLevelEnabled('info', 'error')).toBe(true);
  });

  it('config 레벨과 같은 우선순위 메시지 레벨은 활성화된다', () => {
    expect(isLogLevelEnabled('info', 'info')).toBe(true);
  });

  it('config 레벨보다 낮은 우선순위 메시지 레벨은 비활성화된다', () => {
    expect(isLogLevelEnabled('info', 'debug')).toBe(false);
  });

  it('알 수 없는 로그 레벨은 info 우선순위로 처리된다', () => {
    // 'unknown' falls back to info priority (1), which is >= info config level
    expect(isLogLevelEnabled('info', 'unknown')).toBe(true);
  });
});

describe('STORAGE_TYPE 환경변수 테스트', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('STORAGE_TYPE이 memory일 때 loadConfig가 storageType=memory를 반환한다', () => {
    vi.stubEnv('STORAGE_TYPE', 'memory');
    const cfg = loadConfig();
    expect(cfg.storageType).toBe('memory');
  });

  it('STORAGE_TYPE이 sqlite일 때 loadConfig가 storageType=sqlite를 반환한다', () => {
    vi.stubEnv('STORAGE_TYPE', 'sqlite');
    const cfg = loadConfig();
    expect(cfg.storageType).toBe('sqlite');
  });

  it('STORAGE_TYPE이 알 수 없는 값일 때 loadConfig가 해당 값을 그대로 반환한다', () => {
    vi.stubEnv('STORAGE_TYPE', 'unknown');
    const cfg = loadConfig();
    // loadConfig casts to 'memory' | 'sqlite' without validation — unknown value passes through
    expect(cfg.storageType).toBe('unknown');
  });
});

describe('STORAGE_PATH 환경변수 테스트', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('STORAGE_PATH가 설정되었을 때 loadConfig가 해당 경로를 반환한다', () => {
    vi.stubEnv('STORAGE_PATH', '/tmp/test.db');
    const cfg = loadConfig();
    expect(cfg.storagePath).toBe('/tmp/test.db');
  });

  it('STORAGE_PATH가 없고 storageType이 memory일 때 기본값 :memory:을 반환한다', () => {
    vi.stubEnv('STORAGE_TYPE', 'memory');
    delete process.env.STORAGE_PATH;
    const cfg = loadConfig();
    expect(cfg.storagePath).toBe(':memory:');
  });

  it('STORAGE_PATH가 없고 storageType이 sqlite일 때 기본 경로를 반환한다', () => {
    vi.stubEnv('STORAGE_TYPE', 'sqlite');
    delete process.env.STORAGE_PATH;
    const cfg = loadConfig();
    expect(cfg.storagePath).toBe('./data/redbis.db');
  });
});

describe('createStorage 팩토리 테스트', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('storageType이 memory일 때 InMemoryStorage 인스턴스를 반환한다', () => {
    vi.stubEnv('STORAGE_TYPE', 'memory');
    const cfg = loadConfig();
    const storage = createStorage(cfg);
    expect(storage).toBeInstanceOf(InMemoryStorage);
  });

  it('storageType이 sqlite일 때 SqliteStorage 인스턴스를 반환한다', () => {
    vi.stubEnv('STORAGE_TYPE', 'sqlite');
    vi.stubEnv('STORAGE_PATH', ':memory:');
    const cfg = loadConfig();
    const storage = createStorage(cfg);
    expect(storage).toBeInstanceOf(SqliteStorage);
  });

  it('storageType이 알 수 없는 값일 때 에러를 발생시킨다', () => {
    const cfg = { ...loadConfig(), storageType: 'unknown' as 'memory' | 'sqlite' };
    expect(() => createStorage(cfg)).toThrow('Unknown storage type');
  });
});

describe('parsePort 단위 테스트', () => {
  it('undefined를 전달하면 기본값을 반환한다', () => {
    expect(parsePort(undefined, 6379)).toBe(6379);
  });

  it('유효하지 않은 문자열을 전달하면 에러를 발생시킨다', () => {
    expect(() => parsePort('abc', 6379)).toThrow('유효하지 않은 포트 번호');
  });

  it('0을 전달하면 에러를 발생시킨다', () => {
    expect(() => parsePort('0', 6379)).toThrow('유효하지 않은 포트 번호');
  });

  it('범위를 벗어난 포트를 전달하면 에러를 발생시킨다', () => {
    expect(() => parsePort('70000', 6379)).toThrow('유효하지 않은 포트 번호');
  });
});

describe('parseLogLevel 단위 테스트', () => {
  it('undefined를 전달하면 기본값을 반환한다', () => {
    expect(parseLogLevel(undefined, 'info')).toBe('info');
  });

  it('유효하지 않은 문자열을 전달하면 에러를 발생시킨다', () => {
    expect(() => parseLogLevel('invalid', 'info')).toThrow('유효하지 않은 로그 레벨');
  });

  it('대문자 문자열을 소문자로 정규화한다', () => {
    expect(parseLogLevel('DEBUG', 'info')).toBe('debug');
  });
});