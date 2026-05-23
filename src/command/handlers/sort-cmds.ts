import { HandlerContext, CommandFn } from '../context';
import { encodeError, encodeInteger, encodeArray } from '../../protocol/resp';

export function registerSortCommands(registry: Map<string, CommandFn>): void {
  registry.set('SORT', handleSort);
  registry.set('SORT_RO', handleSortRo);
}

async function handleSort(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'SORT' command");
  }
  const key = args[0];
  let byPattern: string | undefined;
  let limit: { offset: number; count: number } | undefined;
  const getPatterns: string[] = [];
  let sortOrder: 'ASC' | 'DESC' = 'ASC';
  let alpha = false;
  let store: string | undefined;

  let i = 1;
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    switch (opt) {
      case 'BY':
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        byPattern = args[i];
        break;
      case 'LIMIT':
        i++;
        if (i + 1 >= args.length) return encodeError('ERR syntax error');
        const offset = parseInt(args[i]);
        i++;
        const count = parseInt(args[i]);
        if (isNaN(offset) || isNaN(count))
          return encodeError('ERR value is not an integer or out of range');
        limit = { offset, count };
        break;
      case 'GET':
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        getPatterns.push(args[i]);
        break;
      case 'ASC':
        sortOrder = 'ASC';
        break;
      case 'DESC':
        sortOrder = 'DESC';
        break;
      case 'ALPHA':
        alpha = true;
        break;
      case 'STORE':
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        store = args[i];
        break;
      default:
        return encodeError('ERR syntax error');
    }
    i++;
  }

  try {
    const result = await ctx.storage.sort(key, {
      byPattern,
      limit,
      getPatterns: getPatterns.length > 0 ? getPatterns : undefined,
      sortOrder,
      alpha,
      store,
    });
    if (typeof result === 'number') {
      return encodeInteger(result);
    }
    return encodeArray(result);
  } catch (e: any) {
    if (e.message.startsWith('WRONGTYPE')) {
      return `-${e.message}\r\n`;
    }
    return encodeError(e.message);
  }
}

async function handleSortRo(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 1) {
    return encodeError("wrong number of arguments for 'SORT_RO' command");
  }
  const key = args[0];
  let byPattern: string | undefined;
  let limit: { offset: number; count: number } | undefined;
  const getPatterns: string[] = [];
  let sortOrder: 'ASC' | 'DESC' = 'ASC';
  let alpha = false;
  let store: string | undefined;

  let i = 1;
  while (i < args.length) {
    const opt = args[i].toUpperCase();
    switch (opt) {
      case 'BY':
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        byPattern = args[i];
        break;
      case 'LIMIT':
        i++;
        if (i + 1 >= args.length) return encodeError('ERR syntax error');
        const offset = parseInt(args[i]);
        i++;
        const count = parseInt(args[i]);
        if (isNaN(offset) || isNaN(count))
          return encodeError('ERR value is not an integer or out of range');
        limit = { offset, count };
        break;
      case 'GET':
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        getPatterns.push(args[i]);
        break;
      case 'ASC':
        sortOrder = 'ASC';
        break;
      case 'DESC':
        sortOrder = 'DESC';
        break;
      case 'ALPHA':
        alpha = true;
        break;
      case 'STORE':
        i++;
        if (i >= args.length) return encodeError('ERR syntax error');
        store = args[i];
        break;
      default:
        return encodeError('ERR syntax error');
    }
    i++;
  }

  // SORT_RO rejects STORE
  if (store !== undefined) {
    return encodeError("SORT_RO can't be used with STORE option");
  }

  try {
    const result = await ctx.storage.sort(key, {
      byPattern,
      limit,
      getPatterns: getPatterns.length > 0 ? getPatterns : undefined,
      sortOrder,
      alpha,
    });
    if (typeof result === 'number') {
      return encodeInteger(result);
    }
    return encodeArray(result);
  } catch (e: any) {
    if (e.message.startsWith('WRONGTYPE')) {
      return `-${e.message}\r\n`;
    }
    return encodeError(e.message);
  }
}
