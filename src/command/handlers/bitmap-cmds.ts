import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerBitmapCommands(registry: Map<string, CommandFn>): void {
  registry.set('SETBIT', handleSetbit);
  registry.set('GETBIT', handleGetbit);
  registry.set('BITCOUNT', handleBitcount);
  registry.set('BITPOS', handleBitpos);
  registry.set('BITOP', handleBitop);
  registry.set('BITFIELD', handleBitfield);
  registry.set('BITFIELD_RO', handleBitfieldRo);
}

async function handleSetbit(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 3) return encodeError("wrong number of arguments for 'SETBIT' command");
  const key = args[0];
  const offset = parseInt(args[1]);
  const value = parseInt(args[2]);
  if (isNaN(offset) || offset < 0) return encodeError('ERR bit offset is not an integer or out of range');
  if (value !== 0 && value !== 1) return encodeError('ERR bit is not an integer or out of range');
  const result = await ctx.storage.setbit(key, offset, value as 0 | 1);
  return encodeInteger(result);
}

async function handleGetbit(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length !== 2) return encodeError("wrong number of arguments for 'GETBIT' command");
  const offset = parseInt(args[1]);
  if (isNaN(offset) || offset < 0) return encodeError('ERR bit offset is not an integer or out of range');
  const result = await ctx.storage.getbit(args[0], offset);
  return encodeInteger(result);
}

async function handleBitcount(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'BITCOUNT' command");
  let start: number | undefined;
  let end: number | undefined;
  if (args.length >= 2) {
    start = parseInt(args[1]);
    if (isNaN(start)) return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length >= 3) {
    end = parseInt(args[2]);
    if (isNaN(end)) return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.bitcount(args[0], start, end);
  return encodeInteger(result);
}

async function handleBitpos(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'BITPOS' command");
  const bit = parseInt(args[1]);
  if (bit !== 0 && bit !== 1) return encodeError('ERR bit is not an integer or out of range');
  let start: number | undefined;
  let end: number | undefined;
  if (args.length >= 3) {
    start = parseInt(args[2]);
    if (isNaN(start)) return encodeError('ERR value is not an integer or out of range');
  }
  if (args.length >= 4) {
    end = parseInt(args[3]);
    if (isNaN(end)) return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.bitpos(args[0], bit as 0 | 1, start, end);
  return encodeInteger(result);
}

async function handleBitop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'BITOP' command");
  const operation = args[0].toUpperCase() as 'AND' | 'OR' | 'XOR' | 'NOT';
  if (!['AND', 'OR', 'XOR', 'NOT'].includes(operation)) return encodeError('ERR syntax error');
  const destkey = args[1];
  const keys = args.slice(2);
  if (operation === 'NOT' && keys.length !== 1) return encodeError('ERR BITOP NOT requires exactly one source key');
  const result = await ctx.storage.bitop(operation, destkey, keys);
  return encodeInteger(result);
}

async function handleBitfield(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'BITFIELD' command");
  const key = args[0];
  const operations: Array<{ type: 'GET' | 'SET' | 'INCRBY'; encoding: string; offset: number; value?: number; overflow?: 'WRAP' | 'SAT' | 'FAIL' }> = [];
  let currentOverflow: 'WRAP' | 'SAT' | 'FAIL' = 'WRAP';
  let i = 1;
  while (i < args.length) {
    const cmd = args[i].toUpperCase();
    if (cmd === 'OVERFLOW') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const mode = args[i].toUpperCase();
      if (!['WRAP', 'SAT', 'FAIL'].includes(mode)) return encodeError('ERR syntax error');
      currentOverflow = mode as 'WRAP' | 'SAT' | 'FAIL';
      i++;
      continue;
    }
    if (cmd === 'GET') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const encoding = args[i].toUpperCase();
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      operations.push({ type: 'GET', encoding, offset, overflow: currentOverflow });
      i++;
    } else if (cmd === 'SET') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const encoding = args[i].toUpperCase();
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const value = parseInt(args[i]);
      if (isNaN(value)) return encodeError('ERR value is not an integer or out of range');
      operations.push({ type: 'SET', encoding, offset, value, overflow: currentOverflow });
      i++;
    } else if (cmd === 'INCRBY') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const encoding = args[i].toUpperCase();
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const increment = parseInt(args[i]);
      if (isNaN(increment)) return encodeError('ERR value is not an integer or out of range');
      operations.push({ type: 'INCRBY', encoding, offset, value: increment, overflow: currentOverflow });
      i++;
    } else {
      return encodeError('ERR syntax error');
    }
  }
  const result = await ctx.storage.bitfield(key, operations);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeInteger(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleBitfieldRo(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'BITFIELD_RO' command");
  const key = args[0];
  const operations: Array<{ type: 'GET'; encoding: string; offset: number }> = [];
  let i = 1;
  while (i < args.length) {
    const cmd = args[i].toUpperCase();
    if (cmd === 'GET') {
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const encoding = args[i].toUpperCase();
      i++;
      if (i >= args.length) return encodeError('ERR syntax error');
      const offset = parseInt(args[i]);
      if (isNaN(offset)) return encodeError('ERR value is not an integer or out of range');
      operations.push({ type: 'GET', encoding, offset });
      i++;
    } else {
      return encodeError('ERR syntax error');
    }
  }
  const result = await ctx.storage.bitfieldRo(key, operations);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeInteger(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}