import { describe, it, expect } from 'vitest';
import { RespParser } from '../protocol/parser';

describe('RespParser', () => {
  it('RespParser 인스턴스를 생성할 수 있다', () => {
    const parser = new RespParser();
    expect(parser).toBeInstanceOf(RespParser);
  });

  it('feed 메서드가 예외 없이 호출된다', () => {
    const parser = new RespParser();
    expect(() => parser.feed(Buffer.from('*1\r\n$4\r\nPING\r\n'))).not.toThrow();
  });

  it('parse 메서드가 null을 반환한다', () => {
    const parser = new RespParser();
    expect(parser.parse()).toBeNull();
  });

  it('feed 호출 후에도 parse는 null을 반환한다', () => {
    const parser = new RespParser();
    parser.feed(Buffer.from('*1\r\n$4\r\nPING\r\n'));
    expect(parser.parse()).toBeNull();
  });

  it('빈 버퍼로 feed를 호출해도 예외가 발생하지 않는다', () => {
    const parser = new RespParser();
    expect(() => parser.feed(Buffer.alloc(0))).not.toThrow();
  });
});