import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, isLogLevelEnabled } from '../config';

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