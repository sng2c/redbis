import { HandlerContext, CommandFn } from '../context';
import { encodeSimpleString, encodeError, encodeRawArray } from '../../protocol/resp';

export function registerTransactionCommands(registry: Map<string, CommandFn>): void {
  registry.set('MULTI', handleMulti);
  registry.set('EXEC', handleExec);
  registry.set('DISCARD', handleDiscard);
  registry.set('RESET', handleReset);
}

function handleMulti(ctx: HandlerContext, _args: string[]): string {
  if (ctx.inMulti) {
    return encodeError('MULTI calls can not be nested');
  }
  ctx.inMulti = true;
  ctx.multiQueue = [];
  return encodeSimpleString('OK');
}

async function handleExec(ctx: HandlerContext, _args: string[]): Promise<string> {
  if (!ctx.inMulti) {
    return encodeError('EXEC without MULTI');
  }
  ctx.inMulti = false;
  const queue = ctx.multiQueue;
  ctx.multiQueue = [];
  const results: string[] = [];
  for (const cmdArgs of queue) {
    let result: string;
    try {
      const command = cmdArgs[0].toUpperCase();
      const handler = ctx.registry.get(command);
      if (handler) {
        result = await handler(ctx, cmdArgs.slice(1));
      } else {
        result = encodeError(`unknown command '${cmdArgs[0]}'`);
      }
    } catch (e: any) {
      if (e.message.startsWith('WRONGTYPE')) {
        result = `-${e.message}\r\n`;
      } else {
        result = encodeError(e.message);
      }
    }
    results.push(result);
  }
  return encodeRawArray(results);
}

function handleDiscard(ctx: HandlerContext, _args: string[]): string {
  if (!ctx.inMulti) {
    return encodeError('DISCARD without MULTI');
  }
  ctx.inMulti = false;
  ctx.multiQueue = [];
  return encodeSimpleString('OK');
}

function handleReset(ctx: HandlerContext, _args: string[]): string {
  ctx.inMulti = false;
  ctx.multiQueue = [];
  ctx.clientName = '';
  ctx.pubsub.unsubscribeAll(ctx.connId);
  return encodeSimpleString('RESET');
}
