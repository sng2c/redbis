import { describe, it, expect } from 'vitest';
import { RespParser } from '../protocol/parser';

describe('RespParser', () => {
  describe('인라인 명령 파싱', () => {
    it('간단한 인라인 명령을 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('PING\r\n'));
      expect(parser.parse()).toEqual(['PING']);
    });

    it('인라인 명령의 인자를 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('SET mykey myvalue\r\n'));
      expect(parser.parse()).toEqual(['SET', 'mykey', 'myvalue']);
    });

    it('여러 개의 공백을 무시하고 인라인 명령을 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('SET   key   value\r\n'));
      expect(parser.parse()).toEqual(['SET', 'key', 'value']);
    });
  });

  describe('RESP 배열 파싱', () => {
    it('단일 요소 RESP 배열을 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*1\r\n$4\r\nPING\r\n'));
      expect(parser.parse()).toEqual(['PING']);
    });

    it('여러 요소 RESP 배열을 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n'));
      expect(parser.parse()).toEqual(['SET', 'key', 'value']);
    });

    it('GET 명령 RESP 배열을 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*2\r\n$3\r\nGET\r\n$3\r\nkey\r\n'));
      expect(parser.parse()).toEqual(['GET', 'key']);
    });

    it('DEL 명령 RESP 배열을 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*3\r\n$3\r\nDEL\r\n$3\r\nkey\r\n$4\r\nkey2\r\n'));
      expect(parser.parse()).toEqual(['DEL', 'key', 'key2']);
    });

    it('빈 bulk 문자열을 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*2\r\n$3\r\nSET\r\n$0\r\n\r\n'));
      expect(parser.parse()).toEqual(['SET', '']);
    });
  });

  describe('불완전 데이터 및 스트리밍', () => {
    it('불완전한 데이터는 null을 반환한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*1\r\n'));
      expect(parser.parse()).toBeNull();
    });

    it('불완전한 bulk 문자열은 null을 반환한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*1\r\n$4\r\nPI'));
      expect(parser.parse()).toBeNull();
    });

    it('스트리밍으로 데이터를 순차적으로 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*1\r\n$4\r\n'));
      expect(parser.parse()).toBeNull();
      parser.feed(Buffer.from('PING\r\n'));
      expect(parser.parse()).toEqual(['PING']);
    });
  });

  describe('순차 명령 파싱', () => {
    it('단일 버퍼에서 여러 RESP 배열을 순차적으로 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*1\r\n$4\r\nPING\r\n*2\r\n$3\r\nGET\r\n$3\r\nkey\r\n'));
      expect(parser.parse()).toEqual(['PING']);
      expect(parser.parse()).toEqual(['GET', 'key']);
      expect(parser.parse()).toBeNull();
    });

    it('단일 버퍼에서 여러 인라인 명령을 순차적으로 파싱한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('PING\r\nGET key\r\n'));
      expect(parser.parse()).toEqual(['PING']);
      expect(parser.parse()).toEqual(['GET', 'key']);
      expect(parser.parse()).toBeNull();
    });
  });

  describe('빈 버퍼', () => {
    it('빈 버퍼로 feed를 호출해도 예외가 발생하지 않는다', () => {
      const parser = new RespParser();
      expect(() => parser.feed(Buffer.alloc(0))).not.toThrow();
    });

    it('빈 상태에서 parse는 null을 반환한다', () => {
      const parser = new RespParser();
      expect(parser.parse()).toBeNull();
    });
  });

  describe('0-요소 배열 파싱', () => {
    it('*0\\r\\n은 빈 배열을 반환한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*0\r\n'));
      expect(parser.parse()).toEqual([]);
    });
  });

  describe('배열 내 null bulk string', () => {
    it('null bulk string이 포함된 배열을 파싱하면 빈 문자열로 처리한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*2\r\n$3\r\nfoo\r\n$-1\r\n'));
      expect(parser.parse()).toEqual(['foo', '']);
    });
  });

  describe('비숫자 count 값', () => {
    it('배열 접두사가 숫자가 아닌 경우 null을 반환한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*abc\r\n$3\r\nfoo\r\n'));
      expect(parser.parse()).toBeNull();
    });
  });

  describe('빈 인라인 커맨드', () => {
    it('빈 줄 \\r\\n은 빈 토큰 배열을 반환한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('\r\n'));
      expect(parser.parse()).toEqual([]);
    });
  });

  describe('혼합 타입 요소 배열', () => {
    it('Simple String과 Integer가 혼합된 배열은 파싱할 수 없다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*3\r\n+OK\r\n:100\r\n$3\r\nbar\r\n'));
      // 현재 파서는 배열 내 요소로 bulk string($ prefix)만 지원
      expect(parser.parse()).toBeNull();
    });
  });

  describe('연속 파싱 - 여러 인라인 커맨드', () => {
    it('여러 인라인 커맨드를 한 번에 feed 후 parse 반복 호출로 모두 소비한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('PING\r\nSET key val\r\n'));
      expect(parser.parse()).toEqual(['PING']);
      expect(parser.parse()).toEqual(['SET', 'key', 'val']);
      expect(parser.parse()).toBeNull();
    });
  });

  describe('부분 데이터 후 추가 feed', () => {
    it('첫 feed로 불완전한 데이터를 넣고 두 번째 feed로 완성한다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from('*1\r\n$5\r\nhel'));
      expect(parser.parse()).toBeNull();
      parser.feed(Buffer.from('lo\r\n'));
      expect(parser.parse()).toEqual(['hello']);
    });
  });

  describe('음수 정수 인라인 파싱', () => {
    it(':-1000\\r\\n은 인라인 커맨드로 파싱된다', () => {
      const parser = new RespParser();
      parser.feed(Buffer.from(':-1000\r\n'));
      expect(parser.parse()).toEqual([':-1000']);
    });
  });
});
