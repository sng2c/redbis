import { HandlerContext, CommandFn } from '../context';
import {
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArray,
} from '../../protocol/resp';

export function registerPubsubCommands(registry: Map<string, CommandFn>): void {
  registry.set('SUBSCRIBE', handleSubscribe);
  registry.set('UNSUBSCRIBE', handleUnsubscribe);
  registry.set('PSUBSCRIBE', handlePsubscribe);
  registry.set('PUNSUBSCRIBE', handlePunsubscribe);
  registry.set('PUBLISH', handlePublish);
  registry.set('SPUBLISH', handleSpublish);
  registry.set('SSUBSCRIBE', handleSsubscribe);
  registry.set('SUNSUBSCRIBE', handleSunsubscribe);
  registry.set('PUBSUB', handlePubsub);
}

function handleSubscribe(ctx: HandlerContext, args: string[]): string {
  if (args.length === 0) return encodeArray(null);
  const results = ctx.pubsub.subscribe(ctx.connId, args, ctx.send);
  return results.join('');
}

function handleUnsubscribe(ctx: HandlerContext, args: string[]): string {
  const results = ctx.pubsub.unsubscribe(ctx.connId, args.length === 0 ? [] : args);
  return results.join('');
}

function handlePsubscribe(ctx: HandlerContext, args: string[]): string {
  if (args.length === 0) return encodeArray(null);
  const results = ctx.pubsub.psubscribe(ctx.connId, args, ctx.send);
  return results.join('');
}

function handlePunsubscribe(ctx: HandlerContext, args: string[]): string {
  const results = ctx.pubsub.punsubscribe(ctx.connId, args.length === 0 ? [] : args);
  return results.join('');
}

async function handlePublish(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError('wrong number of arguments for \'PUBLISH\' command');
  const count = ctx.pubsub.publish(args[0], args[1]);
  return encodeInteger(count);
}

async function handleSpublish(ctx: HandlerContext, args: string[]): Promise<string> {
  if (args.length < 2) return encodeError('wrong number of arguments for \'SPUBLISH\' command');
  const count = ctx.pubsub.publish(args[0], args[1]);
  return encodeInteger(count);
}

function handleSsubscribe(ctx: HandlerContext, args: string[]): string {
  if (args.length === 0) return encodeArray(null);
  const results = ctx.pubsub.subscribe(ctx.connId, args, ctx.send);
  return results.join('');
}

function handleSunsubscribe(ctx: HandlerContext, args: string[]): string {
  const results = ctx.pubsub.unsubscribe(ctx.connId, args.length === 0 ? [] : args);
  return results.join('');
}

function handlePubsub(ctx: HandlerContext, args: string[]): string {
  if (args.length === 0) return encodeArray(null);
  const sub = args[0].toUpperCase();
  switch (sub) {
    case 'CHANNELS': {
      const pattern = args[1];
      const channels = ctx.pubsub.getChannels(pattern);
      return encodeArray(channels);
    }
    case 'NUMSUB': {
      const channels = args.slice(1);
      const results = ctx.pubsub.getNumSub(channels);
      const flat: string[] = [];
      for (const [ch, count] of results) {
        flat.push(ch, String(count));
      }
      return encodeArray(flat);
    }
    case 'NUMPAT': {
      const count = ctx.pubsub.getNumPat();
      return encodeInteger(count);
    }
    case 'SHARDCHANNELS': {
      const pattern = args[1];
      const channels = ctx.pubsub.getChannels(pattern);
      return encodeArray(channels);
    }
    case 'SHARDNUMSUB': {
      const channels = args.slice(1);
      const results = ctx.pubsub.getNumSub(channels);
      const flat: string[] = [];
      for (const [ch, count] of results) {
        flat.push(ch, String(count));
      }
      return encodeArray(flat);
    }
    default:
      return encodeError('unknown subcommand');
  }
}