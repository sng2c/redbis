// Redis 명령 핸들러
// 파싱된 명령을 받아 스토리지에 대한 CRUD 작업을 수행하고
// RESP 프로토콜 형식의 응답을 반환합니다.
//
// 리팩토링: Command Registry 패턴을 사용하여 기능별 모듈로 분리

import { IStorage } from '../storage/interface';
import { PubSubManager } from '../pubsub/manager';
import { HandlerContext, CommandFn } from './context';
import { createCommandRegistry } from './registry';
import { encodeSimpleString, encodeError } from '../protocol/resp';
import { recordSlowLog } from './slowlog';

export class CommandHandler {
  private ctx: HandlerContext;
  private registry: Map<string, CommandFn>;

  constructor(storage: IStorage, pubsub: PubSubManager, connId: string, send: (msg: string) => void) {
    this.registry = createCommandRegistry();
    this.ctx = {
      storage,
      pubsub,
      connId,
      send,
      registry: this.registry,
      inMulti: false,
      multiQueue: [],
      clientName: '',
    };
  }

  /** Clean up PubSub subscriptions when connection closes. */
  destroy(): void {
    this.ctx.pubsub.unsubscribeAll(this.ctx.connId);
  }

  async execute(args: string[]): Promise<string> {
    if (args.length === 0) {
      return encodeError('unknown command');
    }

    const command = args[0].toUpperCase();
    const start = Date.now();

    // Transaction queuing: when in MULTI, most commands are queued
    if (this.ctx.inMulti) {
      if (command === 'MULTI') {
        return encodeError('MULTI calls can not be nested');
      }
      if (command === 'EXEC' || command === 'DISCARD' || command === 'RESET' || command === 'AUTH' || command === 'HELLO') {
        // These control the transaction or connection - fall through to dispatch
      } else {
        this.ctx.multiQueue.push(args);
        return encodeSimpleString('QUEUED');
      }
    }

    try {
      const handler = this.registry.get(command);
      if (handler) {
        return await handler(this.ctx, args.slice(1));
      }
      return encodeError(`unknown command '${args[0]}'`);
    } catch (e: any) {
      if (e.message.startsWith('WRONGTYPE')) {
        return `-${e.message}\r\n`;
      }
      return encodeError(e.message);
    } finally {
      recordSlowLog(args, Date.now() - start);
    }
  }
}