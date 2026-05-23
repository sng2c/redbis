export function encodeSimpleString(str: string): string {
  return `+${str}\r\n`;
}

export function encodeError(msg: string): string {
  return `-ERR ${msg}\r\n`;
}

export function encodeInteger(num: number): string {
  return `:${num}\r\n`;
}

export function encodeBulkString(str: string | null): string {
  if (str === null) {
    return '$-1\r\n';
  }
  const len = Buffer.byteLength(str, 'utf-8');
  return `$${len}\r\n${str}\r\n`;
}

export function encodeArray(items: string[] | null): string {
  if (items === null) {
    return '*-1\r\n';
  }
  let result = `*${items.length}\r\n`;
  for (const item of items) {
    result += encodeBulkString(item);
  }
  return result;
}

export function encodeRawArray(items: string[]): string {
  return `*${items.length}\r\n${items.join('')}`;
}
