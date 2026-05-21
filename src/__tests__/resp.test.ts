import { describe, it, expect } from 'vitest';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../protocol/resp';

describe('RESP 인코딩', () => {
  describe('encodeSimpleString', () => {
    it('단순 문자열을 인코딩한다', () => {
      expect(encodeSimpleString('OK')).toBe('+OK\r\n');
    });

    it('PONG을 인코딩한다', () => {
      expect(encodeSimpleString('PONG')).toBe('+PONG\r\n');
    });

    it('빈 문자열을 인코딩한다', () => {
      expect(encodeSimpleString('')).toBe('+\r\n');
    });
  });

  describe('encodeError', () => {
    it('에러 메시지를 인코딩한다', () => {
      expect(encodeError('unknown command')).toBe('-ERR unknown command\r\n');
    });

    it('빈 에러 메시지를 인코딩한다', () => {
      expect(encodeError('')).toBe('-ERR \r\n');
    });
  });

  describe('encodeInteger', () => {
    it('양수를 인코딩한다', () => {
      expect(encodeInteger(1)).toBe(':1\r\n');
    });

    it('0을 인코딩한다', () => {
      expect(encodeInteger(0)).toBe(':0\r\n');
    });

    it('음수를 인코딩한다', () => {
      expect(encodeInteger(-1)).toBe(':-1\r\n');
    });
  });

  describe('encodeBulkString', () => {
    it('문자열을 bulk string으로 인코딩한다', () => {
      expect(encodeBulkString('hello')).toBe('$5\r\nhello\r\n');
    });

    it('한글 문자열을 bulk string으로 인코딩한다', () => {
      expect(encodeBulkString('안녕')).toBe('$6\r\n안녕\r\n');  // UTF-8: 3 bytes per char = 6
    });

    it('빈 문자열을 인코딩한다', () => {
      expect(encodeBulkString('')).toBe('$0\r\n\r\n');
    });

    it('null 값을 null bulk string으로 인코딩한다', () => {
      expect(encodeBulkString(null)).toBe('$-1\r\n');
    });
  });

  describe('encodeArray', () => {
    it('문자열 배열을 인코딩한다', () => {
      const result = encodeArray(['key1', 'key2']);
      expect(result).toBe('*2\r\n$4\r\nkey1\r\n$4\r\nkey2\r\n');
    });

    it('빈 배열을 인코딩한다', () => {
      expect(encodeArray([])).toBe('*0\r\n');
    });

    it('null 배열을 null array로 인코딩한다', () => {
      expect(encodeArray(null)).toBe('*-1\r\n');
    });

    it('단일 요소 배열을 인코딩한다', () => {
      expect(encodeArray(['hello'])).toBe('*1\r\n$5\r\nhello\r\n');
    });
  });
});