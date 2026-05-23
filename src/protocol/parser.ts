export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  public feed(data: Buffer): void {
    if (data.length === 0) {
      return;
    }
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  public parse(): string[] | null {
    if (this.buffer.length === 0) {
      return null;
    }
    const firstByte = this.buffer[0];
    if (firstByte === 0x2a) {
      // '*' — RESP array
      return this.parseRespArray();
    } else {
      // Inline command
      return this.parseInlineCommand();
    }
  }

  private findCRLF(from: number): number {
    for (let i = from; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === 0x0d && this.buffer[i + 1] === 0x0a) {
        return i;
      }
    }
    return -1;
  }

  private parseInlineCommand(): string[] | null {
    const crlfPos = this.findCRLF(0);
    if (crlfPos === -1) {
      return null;
    }
    const line = this.buffer.toString('utf-8', 0, crlfPos);
    this.buffer = this.buffer.subarray(crlfPos + 2);
    const tokens = line.split(/\s+/).filter((t) => t.length > 0);
    return tokens;
  }

  private parseRespArray(): string[] | null {
    // Find CRLF after *<count>
    const firstCRLF = this.findCRLF(0);
    if (firstCRLF === -1) {
      return null;
    }
    const countStr = this.buffer.toString('utf-8', 1, firstCRLF);
    const count = parseInt(countStr, 10);
    if (isNaN(count)) {
      return null;
    }

    let offset = firstCRLF + 2;
    const args: string[] = [];

    for (let i = 0; i < count; i++) {
      // Check $ prefix
      if (offset >= this.buffer.length) {
        return null;
      }
      if (this.buffer[offset] !== 0x24) {
        // '$'
        return null;
      }

      // Find CRLF after $<len>
      const lenCRLF = this.findCRLF(offset);
      if (lenCRLF === -1) {
        return null;
      }

      const lenStr = this.buffer.toString('utf-8', offset + 1, lenCRLF);
      const len = parseInt(lenStr, 10);
      if (isNaN(len)) {
        return null;
      }

      if (len === -1) {
        // Null bulk string
        args.push('');
        offset = lenCRLF + 2;
        continue;
      }

      const dataStart = lenCRLF + 2;
      const dataEnd = dataStart + len;

      // Need data + trailing CRLF
      if (dataEnd + 2 > this.buffer.length) {
        return null;
      }

      // Verify trailing CRLF
      if (this.buffer[dataEnd] !== 0x0d || this.buffer[dataEnd + 1] !== 0x0a) {
        return null;
      }

      const value = this.buffer.toString('utf-8', dataStart, dataEnd);
      args.push(value);
      offset = dataEnd + 2;
    }

    // Consume parsed bytes from buffer
    this.buffer = this.buffer.subarray(offset);
    return args;
  }
}
