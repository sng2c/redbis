import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
  encodeRawArray,
} from '../../protocol/resp';
import { slowLog, SLOWLOG_MAX } from '../slowlog';

export function registerServerCommands(registry: Map<string, CommandFn>): void {
  registry.set('INFO', handleInfo);
  registry.set('TIME', handleTime);
  registry.set('LASTSAVE', handleLastsave);
  registry.set('SAVE', handleSave);
  registry.set('SHUTDOWN', handleShutdown);
  registry.set('CONFIG', handleConfig);
  registry.set('SLOWLOG', handleSlowlog);
  registry.set('MEMORY', handleMemory);
  registry.set('AUTH', handleAuth);
  registry.set('HELLO', handleHello);
  registry.set('SELECT', handleSelect);
  registry.set('CLIENT', handleClient);
  registry.set('BGSAVE', handleBgsave);
}

async function handleInfo(ctx: HandlerContext, args: string[]): Promise<string> {
  const section = args.length > 0 ? args[0] : undefined;
  const info = await ctx.storage.info(section);
  return encodeBulkString(info);
}

function handleTime(_ctx: HandlerContext, _args: string[]): string {
  const now = new Date();
  const unixSec = Math.floor(now.getTime() / 1000).toString();
  const microSec = (now.getMilliseconds() * 1000).toString();
  return `*2\r\n${encodeBulkString(unixSec)}${encodeBulkString(microSec)}`;
}

async function handleLastsave(ctx: HandlerContext, _args: string[]): Promise<string> {
  const lastSave = await ctx.storage.getLastSaveTime();
  return encodeInteger(lastSave);
}

async function handleSave(ctx: HandlerContext, _args: string[]): Promise<string> {
  await ctx.storage.save();
  return encodeSimpleString('OK');
}

function handleShutdown(_ctx: HandlerContext, _args: string[]): string {
  return encodeSimpleString('OK');
}

function handleConfig(_ctx: HandlerContext, args: string[]): string {
  if (args.length === 0) return encodeArray(null);
  const sub = args[0].toUpperCase();
  switch (sub) {
    case 'GET': {
      if (args.length < 2) return encodeArray(null);
      const param = args[1].toLowerCase();
      switch (param) {
        case 'save':
          return `*2\r\n${encodeBulkString('save')}${encodeBulkString('60 1000')}`;
        case 'appendonly':
          return `*2\r\n${encodeBulkString('appendonly')}${encodeBulkString('no')}`;
        case 'dbfilename':
          return `*2\r\n${encodeBulkString('dbfilename')}${encodeBulkString('dump.rdb')}`;
        case 'dir':
          return `*2\r\n${encodeBulkString('dir')}${encodeBulkString('./')}`;
        default:
          return encodeArray([]);
      }
    }
    case 'SET': {
      if (args.length < 3) return encodeError("wrong number of arguments for 'CONFIG SET' command");
      const param = args[1].toLowerCase();
      switch (param) {
        case 'save':
          return encodeError('CONFIG SET failed');
        case 'appendonly':
        case 'dbfilename':
          return encodeSimpleString('OK');
        default:
          return encodeSimpleString('OK');
      }
    }
    case 'RESETSTAT':
      slowLog.length = 0;
      return encodeSimpleString('OK');
    case 'REWRITE':
      return encodeError('CONFIG REWRITE is not supported. Redbis does not use a config file.');
    default:
      return encodeError('unknown subcommand');
  }
}

function handleSlowlog(_ctx: HandlerContext, args: string[]): string {
  if (args.length === 0) return encodeArray(null);
  const sub = args[0].toUpperCase();
  switch (sub) {
    case 'GET': {
      let count = 10;
      if (args.length >= 2) {
        const c = parseInt(args[1]);
        if (!isNaN(c)) count = c;
      }
      const entries = slowLog.slice(-count);
      const results: string[] = entries.map((e) =>
        encodeRawArray([
          encodeInteger(e.timestamp),
          encodeInteger(e.duration),
          encodeArray(e.command),
        ])
      );
      return encodeRawArray(results);
    }
    case 'LEN':
      return encodeInteger(slowLog.length);
    case 'RESET': {
      slowLog.length = 0;
      return encodeSimpleString('OK');
    }
    default:
      return encodeError('unknown subcommand');
  }
}

async function handleMemory(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length === 0) return encodeError("wrong number of arguments for 'MEMORY' command");
  const sub = args[0].toUpperCase();
  switch (sub) {
    case 'USAGE': {
      if (args.length < 2)
        return encodeError("wrong number of arguments for 'memory|usage' command");
      const key = args[1];
      const value = await ctx.storage.get(key);
      if (value === null) return encodeInteger(-1);
      // Estimate: value length + 64 bytes overhead
      return encodeInteger(value.length + 64);
    }
    default:
      return encodeError('unknown subcommand');
  }
}

function handleAuth(_ctx: HandlerContext, args: string[]): string {
  if (args.length < 1) return encodeError("wrong number of arguments for 'AUTH' command");
  return encodeSimpleString('OK');
}

function handleHello(ctx: HandlerContext, _args: string[]): string {
  return encodeArray([
    'server',
    'redbis',
    'version',
    '1.0.0',
    'proto',
    '2',
    'id',
    ctx.connId,
    'mode',
    'standalone',
    'role',
    'master',
    'databases',
    '1',
  ]);
}

function handleSelect(_ctx: HandlerContext, _args: string[]): string {
  return encodeSimpleString('OK');
}

function handleClient(ctx: HandlerContext, args: string[]): string {
  if (args.length < 1) return encodeError("wrong number of arguments for 'CLIENT' command");
  const sub = args[0].toUpperCase();
  switch (sub) {
    case 'SETNAME':
      if (args.length < 2)
        return encodeError("wrong number of arguments for 'CLIENT|SETNAME' command");
      ctx.clientName = args[1];
      return encodeSimpleString('OK');
    case 'GETNAME':
      return encodeBulkString(ctx.clientName || null);
    case 'ID': {
      // Use a hash of connId as numeric ID
      const numId = parseInt(ctx.connId);
      return encodeInteger(isNaN(numId) ? 0 : numId);
    }
    case 'KILL':
      return encodeSimpleString('OK');
    case 'LIST':
      return encodeBulkString(
        `id=${ctx.connId} fd=-1 name=${ctx.clientName} age=0 idle=0 flags=N db=0 sub=0 psub=0 multi=-1 qbuf=0 qbuf-free=0 obl=0 oll=0 omem=0 events=r cmd=client`
      );
    case 'INFO':
      return encodeBulkString(
        `id=${ctx.connId} fd=-1 name=${ctx.clientName} age=0 idle=0 flags=N db=0`
      );
    case 'PAUSE':
      return encodeSimpleString('OK');
    case 'UNPAUSE':
      return encodeSimpleString('OK');
    case 'UNBLOCK':
      return encodeInteger(0);
    case 'REPLY':
      return encodeSimpleString('OK');
    case 'SETINFO':
      return encodeSimpleString('OK');
    default:
      return encodeError(`unknown subcommand '${args[0]}'. Try CLIENT HELP.`);
  }
}

async function handleBgsave(ctx: HandlerContext, _args: string[]): Promise<string> {
  const result = await ctx.storage.bgsave();
  return encodeSimpleString(result);
}
