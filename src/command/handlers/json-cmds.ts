import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerJsonCommands(registry: Map<string, CommandFn>): void {
  registry.set('JSON.SET', handleJsonSet);
  registry.set('JSON.GET', handleJsonGet);
  registry.set('JSON.DEL', handleJsonDel);
  registry.set('JSON.FORGET', handleJsonForget);
  registry.set('JSON.TYPE', handleJsonType);
  registry.set('JSON.STRLEN', handleJsonStrlen);
  registry.set('JSON.STRAPPEND', handleJsonStrappend);
  registry.set('JSON.OBJKEYS', handleJsonObjkeys);
  registry.set('JSON.OBJLEN', handleJsonObjlen);
  registry.set('JSON.ARRAPPEND', handleJsonArrappend);
  registry.set('JSON.ARRINDEX', handleJsonArrindex);
  registry.set('JSON.ARRINSERT', handleJsonArrinsert);
  registry.set('JSON.ARRLEN', handleJsonArrlen);
  registry.set('JSON.ARRPOP', handleJsonArrpop);
  registry.set('JSON.ARRTRIM', handleJsonArrtrim);
  registry.set('JSON.NUMINCRBY', handleJsonNumincrby);
  registry.set('JSON.NUMMULTBY', handleJsonNummultby);
  registry.set('JSON.MGET', handleJsonMget);
  registry.set('JSON.MSET', handleJsonMset);
  registry.set('JSON.TOGGLE', handleJsonToggle);
  registry.set('JSON.CLEAR', handleJsonClear);
  registry.set('JSON.DEBUG', handleJsonDebug);
  registry.set('JSON.RESP', handleJsonResp);
  registry.set('JSON.MERGE', handleJsonMerge);
}

async function handleJsonSet(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.SET' command");
  const key = args[0];
  const path = args[1];
  const value = args[2];
  let nx = false, xx = false;
  for (let i = 3; i < args.length; i++) {
    const opt = args[i].toUpperCase();
    if (opt === 'NX') nx = true;
    else if (opt === 'XX') xx = true;
    else return encodeError('ERR syntax error');
  }
  const result = await ctx.storage.jsonSet(key, path, value, nx || undefined, xx || undefined);
  if (result === null) return encodeBulkString(null);
  return encodeSimpleString('OK');
}

async function handleJsonGet(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.GET' command");
  const key = args[0];
  const paths = args.length > 1 ? args.slice(1) : undefined;
  const result = await ctx.storage.jsonGet(key, paths);
  return encodeBulkString(result);
}

async function handleJsonDel(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.DEL' command");
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonDel(args[0], path);
  return encodeInteger(result);
}

async function handleJsonForget(ctx: HandlerContext, args: string[]): Promise<string> {
  return handleJsonDel(ctx, args);
}

async function handleJsonType(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.TYPE' command");
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonType(args[0], path);
  if (result === null) return encodeBulkString(null);
  return encodeSimpleString(result);
}

async function handleJsonStrlen(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.STRLEN' command");
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonStrlen(args[0], path);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleJsonStrappend(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.STRAPPEND' command");
  const key = args[0];
  const path = args[1];
  const value = args[2];
  const result = await ctx.storage.jsonStrappend(key, path, value);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleJsonObjkeys(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.OBJKEYS' command");
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonObjkeys(args[0], path);
  if (result === null) return encodeArray(null);
  return encodeArray(result);
}

async function handleJsonObjlen(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.OBJLEN' command");
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonObjlen(args[0], path);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleJsonArrappend(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.ARRAPPEND' command");
  const key = args[0];
  const path = args[1];
  const values = args.slice(2);
  const result = await ctx.storage.jsonArrappend(key, path, values);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeInteger(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleJsonArrindex(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.ARRINDEX' command");
  const key = args[0];
  const path = args[1];
  const value = args[2];
  let start: number | undefined;
  let stop: number | undefined;
  if (args.length >= 4) { start = parseInt(args[3]); if (isNaN(start)) return encodeError('ERR value is not an integer or out of range'); }
  if (args.length >= 5) { stop = parseInt(args[4]); if (isNaN(stop)) return encodeError('ERR value is not an integer or out of range'); }
  const result = await ctx.storage.jsonArrindex(key, path, value, start, stop);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleJsonArrinsert(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 4) return encodeError("wrong number of arguments for 'JSON.ARRINSERT' command");
  const key = args[0];
  const path = args[1];
  const index = parseInt(args[2]);
  if (isNaN(index)) return encodeError('ERR value is not an integer or out of range');
  const values = args.slice(3);
  const result = await ctx.storage.jsonArrinsert(key, path, index, values);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeInteger(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleJsonArrlen(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.ARRLEN' command");
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonArrlen(args[0], path);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleJsonArrpop(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.ARRPOP' command");
  const key = args[0];
  let path: string | undefined;
  let index: number | undefined;
  if (args.length >= 2) path = args[1];
  if (args.length >= 3) {
    index = parseInt(args[2]);
    if (isNaN(index)) return encodeError('ERR value is not an integer or out of range');
  }
  const result = await ctx.storage.jsonArrpop(key, path, index);
  return encodeBulkString(result);
}

async function handleJsonArrtrim(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 4) return encodeError("wrong number of arguments for 'JSON.ARRTRIM' command");
  const key = args[0];
  const path = args[1];
  const start = parseInt(args[2]);
  const stop = parseInt(args[3]);
  if (isNaN(start) || isNaN(stop)) return encodeError('ERR value is not an integer or out of range');
  const result = await ctx.storage.jsonArrtrim(key, path, start, stop);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleJsonNumincrby(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.NUMINCRBY' command");
  const key = args[0];
  const path = args[1];
  const increment = parseFloat(args[2]);
  if (isNaN(increment)) return encodeError('ERR value is not a valid float');
  const result = await ctx.storage.jsonNumincrby(key, path, increment);
  return encodeBulkString(result);
}

async function handleJsonNummultby(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.NUMMULTBY' command");
  const key = args[0];
  const path = args[1];
  const multiplier = parseFloat(args[2]);
  if (isNaN(multiplier)) return encodeError('ERR value is not a valid float');
  const result = await ctx.storage.jsonNummultby(key, path, multiplier);
  return encodeBulkString(result);
}

async function handleJsonMget(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError("wrong number of arguments for 'JSON.MGET' command");
  const path = args[args.length - 1];
  const keys = args.slice(0, args.length - 1);
  const result = await ctx.storage.jsonMget(keys, path);
  const parts = result.map(r => r === null ? encodeBulkString(null) : encodeBulkString(r));
  return `*${parts.length}\r\n${parts.join('')}`;
}

async function handleJsonMset(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3 || args.length % 3 !== 0) return encodeError("wrong number of arguments for 'JSON.MSET' command");
  const pairs: Array<{ key: string; path: string; value: string }> = [];
  for (let i = 0; i < args.length; i += 3) {
    pairs.push({ key: args[i], path: args[i + 1], value: args[i + 2] });
  }
  await ctx.storage.jsonMset(pairs);
  return encodeSimpleString('OK');
}

async function handleJsonToggle(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.TOGGLE' command");
  const key = args[0];
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonToggle(key, path);
  return encodeBulkString(result);
}

async function handleJsonClear(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.CLEAR' command");
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonClear(args[0], path);
  return encodeInteger(result);
}

async function handleJsonDebug(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.DEBUG' command");
  const subcmd = args[0].toUpperCase();
  if (subcmd !== 'MEMORY') return encodeError('unknown subcommand');
  if (args.length < 2) return encodeError("wrong number of arguments for 'JSON.DEBUG MEMORY' command");
  const key = args[1];
  const path = args.length > 2 ? args[2] : undefined;
  const result = await ctx.storage.jsonDebugMemory(key, path);
  if (result === null) return encodeBulkString(null);
  return encodeInteger(result);
}

async function handleJsonResp(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) return encodeError("wrong number of arguments for 'JSON.RESP' command");
  const key = args[0];
  const path = args.length > 1 ? args[1] : undefined;
  const result = await ctx.storage.jsonResp(key, path);
  return result ?? encodeBulkString(null);
}

async function handleJsonMerge(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.MERGE' command");
  const key = args[0];
  const path = args[1];
  const value = args[2];
  await ctx.storage.jsonMerge(key, path, value);
  return encodeSimpleString('OK');
}