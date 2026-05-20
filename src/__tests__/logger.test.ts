import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, createLogger } from '../logger';

// Mock config so we can control log level filtering
vi.mock('../config', () => ({
  config: { port: 6379, host: '127.0.0.1', logLevel: 'debug' },
  isLogLevelEnabled: vi.fn().mockReturnValue(true),
}));

import { isLogLevelEnabled } from '../config';

describe('Logger', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(isLogLevelEnabled).mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('createLogger가 Logger 인스턴스를 반환한다', () => {
    const logger = createLogger('test');
    expect(logger).toBeInstanceOf(Logger);
  });

  describe('Logger.log methods', () => {
    it('info 메서드가 올바른 JSON 형식으로 출력한다', () => {
      const logger = createLogger('test');
      logger.info('테스트 메시지');

      const output = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.level).toBe('info');
      expect(parsed.module).toBe('test');
      expect(parsed.message).toBe('테스트 메시지');
      expect(typeof parsed.timestamp).toBe('string');
      // Verify it's a valid ISO string
      expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
    });

    it('warn 메서드가 올바른 JSON 형식으로 출력한다', () => {
      const logger = createLogger('myApp');
      logger.warn('경고 발생');

      const output = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.level).toBe('warn');
      expect(parsed.module).toBe('myApp');
      expect(parsed.message).toBe('경고 발생');
    });

    it('error 메서드가 올바른 JSON 형식으로 출력한다', () => {
      const logger = createLogger('err');
      logger.error('에러 발생');

      const output = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.level).toBe('error');
      expect(parsed.module).toBe('err');
      expect(parsed.message).toBe('에러 발생');
    });

    it('debug 메서드가 올바른 JSON 형식으로 출력한다', () => {
      const logger = createLogger('debug-mod');
      logger.debug('디버그 메시지');

      const output = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.level).toBe('debug');
      expect(parsed.module).toBe('debug-mod');
      expect(parsed.message).toBe('디버그 메시지');
    });

    it('data 객체가 포함될 때 data 필드가 출력된다', () => {
      const logger = createLogger('test');
      logger.info('메시지', { key: 'value' });

      const output = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed.data).toEqual({ key: 'value' });
    });

    it('data가 빈 객체일 때 data 필드가 생략된다', () => {
      const logger = createLogger('test');
      logger.info('메시지', {});

      const output = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed).not.toHaveProperty('data');
    });

    it('data가 undefined일 때 data 필드가 생략된다', () => {
      const logger = createLogger('test');
      logger.info('메시지');

      const output = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());

      expect(parsed).not.toHaveProperty('data');
    });

    it('출력이 줄바꿈으로 끝난다', () => {
      const logger = createLogger('test');
      logger.info('줄바꿈 테스트');

      const output = writeSpy.mock.calls[0][0] as string;
      expect(output.endsWith('\n')).toBe(true);
    });
  });

  describe('로그 레벨 필터링', () => {
    it('현재 로그 레벨보다 낮은 우선순위 메시지는 출력되지 않는다', () => {
      vi.mocked(isLogLevelEnabled).mockReturnValue(false);

      const logger = createLogger('filtered');
      logger.debug('숨겨짐');

      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});