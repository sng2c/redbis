import { describe, it, expect } from 'vitest';
import { globToRegex } from '../utils/glob';

describe('globToRegex', () => {
  // Wildcard *
  it('* — 빈 문자열도 매칭한다', () => {
    expect(globToRegex('*').test('')).toBe(true);
  });

  it('* — 모든 문자열을 매칭한다', () => {
    expect(globToRegex('*').test('anything')).toBe(true);
  });

  it('* — 여러 위치에서 동작한다', () => {
    expect(globToRegex('prefix*').test('prefixSuffix')).toBe(true);
  });

  it('* — 중간 와일드카드를 매칭한다', () => {
    expect(globToRegex('a*c').test('abc')).toBe(true);
    expect(globToRegex('a*c').test('aXXXc')).toBe(true);
  });

  it('* — 매칭되지 않는 문자열은 false', () => {
    expect(globToRegex('a*c').test('abd')).toBe(false);
  });

  // Single character ?
  it('? — 정확히 한 문자를 매칭한다', () => {
    expect(globToRegex('a?c').test('abc')).toBe(true);
  });

  it('? — 빈 문자열은 매칭하지 않는다', () => {
    expect(globToRegex('a?c').test('ac')).toBe(false);
  });

  it('? — 두 글자 이상은 매칭하지 않는다', () => {
    expect(globToRegex('a?c').test('abbc')).toBe(false);
  });

  it('? — 여러 물음표를 매칭한다', () => {
    expect(globToRegex('??').test('ab')).toBe(true);
    expect(globToRegex('??').test('a')).toBe(false);
  });

  // Character class [abc]
  it('[abc] — 대괄호 안의 문자 중 하나를 매칭한다', () => {
    expect(globToRegex('[abc]').test('a')).toBe(true);
    expect(globToRegex('[abc]').test('d')).toBe(false);
  });

  it('[a-z] — 문자 범위를 매칭한다', () => {
    expect(globToRegex('[a-z]').test('m')).toBe(true);
    expect(globToRegex('[a-z]').test('5')).toBe(false);
  });

  // Negated character class
  it('[!abc] — 부정 대괄호 표현식을 매칭한다', () => {
    expect(globToRegex('[!abc]').test('d')).toBe(true);
    expect(globToRegex('[!abc]').test('a')).toBe(false);
  });

  it('[^abc] — 캐럿 부정 대괄호 표현식을 매칭한다', () => {
    expect(globToRegex('[^abc]').test('d')).toBe(true);
    expect(globToRegex('[^abc]').test('a')).toBe(false);
  });

  // Backslash escaping
  it('\\* — 별표를 리터럴로 매칭한다', () => {
    expect(globToRegex('\\*').test('*')).toBe(true);
    expect(globToRegex('\\*').test('a')).toBe(false);
  });

  it('\\? — 물음표를 리터럴로 매칭한다', () => {
    expect(globToRegex('\\?').test('?')).toBe(true);
    expect(globToRegex('\\?').test('a')).toBe(false);
  });

  it('\\[ — 대괄호를 리터럴로 매칭한다', () => {
    expect(globToRegex('\\[').test('[')).toBe(true);
  });

  it('\\\\ — 백슬래시를 리터럴로 매칭한다', () => {
    expect(globToRegex('\\\\').test('\\')).toBe(true);
  });

  it('일반 문자의 백슬래시 이스케이프', () => {
    expect(globToRegex('\\a').test('a')).toBe(true);
  });

  // Regex-special character escaping
  it('정규식 특수 문자를 이스케이프한다', () => {
    expect(globToRegex('a.b').test('a.b')).toBe(true);
    expect(globToRegex('a.b').test('axb')).toBe(false);
  });

  it('+ 기호를 리터럴로 매칭한다', () => {
    expect(globToRegex('a+b').test('a+b')).toBe(true);
  });

  it('^ 기호를 리터럴로 매칭한다', () => {
    expect(globToRegex('a^b').test('a^b')).toBe(true);
  });

  it('$ 기호를 리터럴로 매칭한다', () => {
    expect(globToRegex('a$b').test('a$b')).toBe(true);
  });

  // ] as first character in bracket
  it('[]] — 닫는 대괄호를 첫 글자로 매칭한다', () => {
    expect(globToRegex('[]a]').test(']')).toBe(true);
  });

  // Anchored matching
  it('패턴이 전체 문자열에 매칭된다', () => {
    expect(globToRegex('abc').test('abcdef')).toBe(false);
  });

  // Complex patterns
  it('복합 패턴 h?llo* 을 매칭한다', () => {
    expect(globToRegex('h?llo*').test('hello_world')).toBe(true);
  });

  it('복합 패턴 prefix[a-z]?* 을 매칭한다', () => {
    expect(globToRegex('prefix[a-z]?*').test('prefixbX')).toBe(true);
  });

  // No pattern special characters
  it('일반 문자열은 정확히 매칭한다', () => {
    expect(globToRegex('hello').test('hello')).toBe(true);
    expect(globToRegex('hello').test('world')).toBe(false);
  });
});