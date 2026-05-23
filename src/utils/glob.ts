/**
 * Convert a glob pattern to a RegExp.
 * Supports: * (any), ? (single char), [abc], [a-z], [^abc], [!abc] (bracket expressions).
 * Backslash escapes the next character: \* matches literal *, \[ matches literal [, etc.
 */
export function globToRegex(pattern: string): RegExp {
  let regexStr = '^';
  let i = 0;
  const len = pattern.length;

  while (i < len) {
    const ch = pattern[i];
    if (ch === '\\') {
      // Escape next character literally
      i++;
      if (i < len) {
        regexStr += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      i++;
    } else if (ch === '*') {
      regexStr += '.*';
      i++;
    } else if (ch === '?') {
      regexStr += '.';
      i++;
    } else if (ch === '[') {
      // Bracket expression: [abc], [a-z], [^abc], [!abc]
      i++; // skip '['
      regexStr += '[';
      if (i < len && (pattern[i] === '^' || pattern[i] === '!')) {
        regexStr += '^';
        i++;
      }
      // Handle ']' as first char inside bracket (literal)
      // Must escape ] with \] inside a JS RegExp character class
      if (i < len && pattern[i] === ']') {
        regexStr += '\\]';
        i++;
      }
      while (i < len && pattern[i] !== ']') {
        if (i + 2 < len && pattern[i + 1] === '-' && pattern[i + 2] !== ']') {
          // Range: a-z
          regexStr += pattern[i] + '-' + pattern[i + 2];
          i += 3;
        } else {
          // Escape regex-special chars inside brackets
          const c = pattern[i];
          if (c === '\\') {
            regexStr += '\\\\';
          } else if ('.+^${}()|'.includes(c)) {
            regexStr += '\\' + c;
          } else {
            regexStr += c;
          }
          i++;
        }
      }
      if (i < len && pattern[i] === ']') {
        i++; // skip ']'
      }
      regexStr += ']';
    } else if ('.+^${}()|\\'.includes(ch)) {
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr);
}
