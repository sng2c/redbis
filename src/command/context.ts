import type { IStorage } from '../storage/interface';
import type { PubSubManager } from '../pubsub/manager';

export interface HandlerContext {
  storage: IStorage;
  pubsub: PubSubManager;
  connId: string;
  send: (msg: string) => void;
  registry: Map<string, CommandFn>;
  inMulti: boolean;
  multiQueue: string[][];
  clientName: string;
}

export type CommandFn = (ctx: HandlerContext, args: string[]) => Promise<string> | string;