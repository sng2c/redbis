import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, isLogLevelEnabled, parsePort, parseLogLevel } from '../config';
import { createStorage, parseConnectionString } from '../storage/factory';
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
    delete process.env.DATABASE_URL;

    const cfg = loadConfig();
    expect(cfg).toEqual({
      port: 6379,
      host: '127.0.0.1',
      logLevel: 'info',
      databaseUrl: 'memory://',
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

describe('DATABASE_URL 환경변수 테스트', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('DATABASE_URL이 memory://일 때 loadConfig가 databaseUrl=memory://를 반환한다', () => {
    vi.stubEnv('DATABASE_URL', 'memory://');
    const cfg = loadConfig();
    expect(cfg.databaseUrl).toBe('memory://');
  });

  it('DATABASE_URL이 sqlite 상대경로일 때 loadConfig가 해당 databaseUrl을 반환한다', () => {
    vi.stubEnv('DATABASE_URL', 'sqlite://./data/redbis.db');
    const cfg = loadConfig();
    expect(cfg.databaseUrl).toBe('sqlite://./data/redbis.db');
  });

  it('DATABASE_URL이 sqlite 절대경로일 때 loadConfig가 해당 databaseUrl을 반환한다', () => {
    vi.stubEnv('DATABASE_URL', 'sqlite:///var/data/db');
    const cfg = loadConfig();
    expect(cfg.databaseUrl).toBe('sqlite:///var/data/db');
  });
});

describe('parseConnectionString 단위 테스트', () => {
  it('memory://을 파싱하면 { type: "memory" }을 반환한다', () => {
    const result = parseConnectionString('memory://');
    expect(result).toEqual({ type: 'memory' });
  });

  it('sqlite:// 상대경로를 파싱하면 { type: "sqlite", path: "./data/redbis.db" }을 반환한다', () => {
    const result = parseConnectionString('sqlite://./data/redbis.db');
    expect(result).toEqual({ type: 'sqlite', path: './data/redbis.db' });
  });

  it('sqlite:/// 절대경로를 파싱하면 { type: "sqlite", path: "/var/data/db" }을 반환한다', () => {
    const result = parseConnectionString('sqlite:///var/data/db');
    expect(result).toEqual({ type: 'sqlite', path: '/var/data/db' });
  });

  it('지원하지 않는 스킴일 때 에러를 발생시킨다', () => {
    expect(() => parseConnectionString('postgres://localhost')).toThrow(
      'Unsupported connection string scheme: postgres'
    );
  });

  it('sqlite:/// 절대경로 다단계를 파싱하면 { type: "sqlite", path: "/absolute/path/db.sqlite" }을 반환한다', () => {
    const result = parseConnectionString('sqlite:///absolute/path/db.sqlite');
    expect(result).toEqual({ type: 'sqlite', path: '/absolute/path/db.sqlite' });
  });

  it('sqlite://:memory:는 in-memory로 처리되지 않는다 (memory://이어야 함)', () => {
    // sqlite://:memory: is treated as a SQLite path string ":memory:", not as in-memory storage
    const result = parseConnectionString('sqlite://:memory:');
    expect(result).toEqual({ type: 'sqlite', path: ':memory:' });
    expect(result.type).toBe('sqlite');
  });

  it('://가 없는 문자열일 때 에러를 발생시킨다', () => {
    expect(() => parseConnectionString('invalid')).toThrow('Unsupported connection string scheme');
  });
});

describe('createStorage 팩토리 테스트', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('databaseUrl이 memory://일 때 InMemoryStorage 인스턴스를 반환한다', () => {
    vi.stubEnv('DATABASE_URL', 'memory://');
    const cfg = loadConfig();
    const storage = createStorage(cfg);
    expect(storage).toBeInstanceOf(InMemoryStorage);
  });

  it('databaseUrl이 sqlite:// 상대경로일 때 SqliteStorage 인스턴스를 반환한다', () => {
    vi.stubEnv('DATABASE_URL', 'sqlite://./data/test-redbis.db');
    const cfg = loadConfig();
    const storage = createStorage(cfg);
    expect(storage).toBeInstanceOf(SqliteStorage);
  });

  it('databaseUrl이 지원하지 않는 스킴일 때 에러를 발생시킨다', () => {
    const cfg = { ...loadConfig(), databaseUrl: 'unknown://host' };
    expect(() => createStorage(cfg)).toThrow('Unsupported connection string scheme');
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
