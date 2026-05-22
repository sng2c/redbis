// @ts-nocheck
import { assertType } from '../type-check';
import type { InMemoryStorage } from './core';
import type { StreamEntry, StreamConsumer, StreamInfo, GroupInfo, PendingEntry } from '../interface';
import type { StreamData, InternalStreamGroup, InternalStreamConsumer } from './types';

export const streamMethods = {
_ensureStreamTypeOrThrow(key: string): void {
    assertType(this.store.get(key)?.type, 'stream');
  },

_ensureStreamKeyExists(key: string): void {
    if (!this.store.has(key)) {
      this.store.set(key, { value: '', type: 'stream', expiresAt: null });
    }
    if (!this.streamStore.has(key)) {
      this.streamStore.set(key, { entries: [], groups: new Map(), lastId: '0-0', maxDeletedId: '0-0', entriesAdded: 0, recordedFirstId: '0-0' });
    }
  },

_cleanupStreamIfEmpty(key: string): void {
    const entry = this.store.get(key);
    if (!entry || entry.type !== 'stream') return;
    const stream = this.streamStore.get(key);
    if (stream && stream.entries.length === 0 && stream.groups.size === 0) {
      this.streamStore.delete(key);
      this.store.delete(key);
    }
  },

_parseStreamId(id: string): { ms: number; seq: number } {
    if (id === '-') return { ms: 0, seq: 0 };
    if (id === '+') return { ms: Infinity, seq: Infinity };
    const parts = id.split('-');
    return { ms: parseInt(parts[0], 10), seq: parseInt(parts[1], 10) };
  },

_formatStreamId(ms: number, seq: number): string {
    return `${ms}-${seq}`;
  },

_compareStreamId(a: string, b: string): number {
    const pa = this._parseStreamId(a);
    const pb = this._parseStreamId(b);
    if (pa.ms !== pb.ms) return pa.ms - pb.ms;
    return pa.seq - pb.seq;
  },

_generateStreamId(key: string, id: string): string | null {
    const stream = this.streamStore.get(key);
    const lastId = stream ? stream.lastId : '0-0';

    if (id === '*') {
      const now = Date.now();
      const lastParsed = this._parseStreamId(lastId);
      if (now > lastParsed.ms) {
        return this._formatStreamId(now, 0);
      } else {
        // Same ms as last or earlier, increment seq
        return this._formatStreamId(lastParsed.ms, lastParsed.seq + 1);
      }
    }

    // Handle id with explicit ms and auto seq (e.g., "12345-*")
    if (id.endsWith('-*')) {
      const ms = parseInt(id.slice(0, -2), 10);
      const lastParsed = this._parseStreamId(lastId);
      if (ms > lastParsed.ms) {
        return this._formatStreamId(ms, 0);
      } else if (ms === lastParsed.ms) {
        return this._formatStreamId(ms, lastParsed.seq + 1);
      } else {
        // ms is less than lastId's ms — can't use
        return null;
      }
    }

    // Explicit id
    if (this._compareStreamId(id, lastId) <= 0) {
      return null; // id <= lastId, not valid
    }
    return id;
  },

_binarySearchStreamEntry(entries: StreamEntry[], id: string, findFirst: boolean): number {
    let left = 0;
    let right = entries.length;
    const parsedId = this._parseStreamId(id);

    while (left < right) {
      const mid = (left + right) >> 1;
      const midParsed = this._parseStreamId(entries[mid].id);
      const cmp = midParsed.ms !== parsedId.ms ? midParsed.ms - parsedId.ms : midParsed.seq - parsedId.seq;
      if (findFirst ? cmp < 0 : cmp <= 0) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  },

async xadd(key: string, id: string, fields: Record<string, string>, options?: { maxlen?: number; approx?: boolean; minid?: string; nomkstream?: boolean }): Promise<string | null> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    // NOMKSTREAM: don't create the stream if it doesn't exist
    if (options?.nomkstream && !this.store.has(key)) {
      return null;
    }

    this._ensureStreamKeyExists(key);
    const stream = this.streamStore.get(key)!;

    const generatedId = this._generateStreamId(key, id);
    if (generatedId === null) {
      throw new Error('ERR The ID specified in XADD is equal or smaller than the target stream top item');
    }

    const entry: StreamEntry = {
      id: generatedId,
      fields: { ...fields },
      createdAt: Date.now(),
    };

    stream.entries.push(entry);
    stream.lastId = generatedId;
    stream.entriesAdded++;

    // Update recordedFirstId if this is the first entry
    if (stream.entries.length === 1 || stream.recordedFirstId === '0-0') {
      stream.recordedFirstId = generatedId;
    }

    // Handle trimming
    if (options?.maxlen !== undefined) {
      await this.xtrim(key, 'MAXLEN', options.maxlen, options.approx ?? false);
    } else if (options?.minid !== undefined) {
      await this.xtrim(key, 'MINID', options.minid, options.approx ?? false);
    }

    return generatedId;
  },

async xtrim(key: string, strategy: 'MAXLEN' | 'MINID', threshold: string | number, approx?: boolean, limit?: number): Promise<number> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream || stream.entries.length === 0) return 0;

    let removeCount = 0;

    if (strategy === 'MAXLEN') {
      const maxLen = typeof threshold === 'number' ? threshold : parseInt(String(threshold), 10);
      if (stream.entries.length <= maxLen) return 0;
      removeCount = stream.entries.length - maxLen;
      if (limit !== undefined && removeCount > limit) {
        removeCount = limit;
      }
      stream.entries.splice(0, removeCount);
    } else {
      // MINID strategy
      const minId = String(threshold);
      const firstToKeep = stream.entries.findIndex(e => this._compareStreamId(e.id, minId) >= 0);
      if (firstToKeep === 0) return 0; // All entries are >= minId
      if (firstToKeep === -1) {
        // All entries are < minId — remove all
        removeCount = stream.entries.length;
        if (limit !== undefined && removeCount > limit) removeCount = limit;
      } else {
        removeCount = firstToKeep;
        if (limit !== undefined && removeCount > limit) removeCount = limit;
      }
      if (removeCount > 0) {
        // Update maxDeletedId
        for (let i = 0; i < removeCount; i++) {
          const deletedId = stream.entries[i].id;
          if (this._compareStreamId(deletedId, stream.maxDeletedId) > 0) {
            stream.maxDeletedId = deletedId;
          }
        }
        stream.entries.splice(0, removeCount);
      }
    }

    // Update recordedFirstId
    if (stream.entries.length > 0) {
      stream.recordedFirstId = stream.entries[0].id;
    }

    return removeCount;
  },

async xdel(key: string, ids: string[]): Promise<number> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) return 0;

    let removed = 0;
    for (const id of ids) {
      const idx = stream.entries.findIndex(e => e.id === id);
      if (idx !== -1) {
        stream.entries.splice(idx, 1);
        removed++;
        if (this._compareStreamId(id, stream.maxDeletedId) > 0) {
          stream.maxDeletedId = id;
        }
      }
    }

    // Update recordedFirstId
    if (stream.entries.length > 0) {
      stream.recordedFirstId = stream.entries[0].id;
    }

    this._cleanupStreamIfEmpty(key);
    return removed;
  },

async xrange(key: string, start: string, end: string, count?: number): Promise<StreamEntry[]> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream || stream.entries.length === 0) return [];

    const startId = start === '-' ? '0-0' : start;
    const endId = end === '+' ? stream.lastId : end;

    let results: StreamEntry[] = [];
    for (const entry of stream.entries) {
      if (this._compareStreamId(entry.id, startId) >= 0 && this._compareStreamId(entry.id, endId) <= 0) {
        results.push(entry);
      }
    }

    if (count !== undefined && count > 0) {
      results = results.slice(0, count);
    }

    return results;
  },

async xrevrange(key: string, end: string, start: string, count?: number): Promise<StreamEntry[]> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream || stream.entries.length === 0) return [];

    const startId = start === '-' ? '0-0' : start;
    const endId = end === '+' ? stream.lastId : end;

    let results: StreamEntry[] = [];
    for (let i = stream.entries.length - 1; i >= 0; i--) {
      const entry = stream.entries[i];
      if (this._compareStreamId(entry.id, startId) >= 0 && this._compareStreamId(entry.id, endId) <= 0) {
        results.push(entry);
      }
    }

    if (count !== undefined && count > 0) {
      results = results.slice(0, count);
    }

    return results;
  },

async xlen(key: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);
    const stream = this.streamStore.get(key);
    return stream ? stream.entries.length : 0;
  },

async xread(keys: string[], ids: string[], count?: number): Promise<Array<{ key: string; entries: StreamEntry[] }> | null> {
    const results: Array<{ key: string; entries: StreamEntry[] }> = [];

    for (let i = 0; i < keys.length; i++) {
      this.evictIfExpired(keys[i]);
      this._ensureStreamTypeOrThrow(keys[i]);
      const stream = this.streamStore.get(keys[i]);
      if (!stream || stream.entries.length === 0) continue;

      const startId = ids[i] === '$' ? stream.lastId : ids[i];
      const entries: StreamEntry[] = [];

      for (const entry of stream.entries) {
        if (this._compareStreamId(entry.id, startId) > 0) {
          entries.push(entry);
          if (count !== undefined && entries.length >= count) break;
        }
      }

      if (entries.length > 0) {
        results.push({ key: keys[i], entries });
      }
    }

    return results.length > 0 ? results : null;
  },

async xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    if (mkstream) {
      this._ensureStreamKeyExists(key);
    }

    const stream = this.streamStore.get(key);
    if (!stream) {
      throw new Error('ERR no such key');
    }

    if (stream.groups.has(group)) {
      throw new Error('BUSYGROUP Consumer Group name already exists');
    }

    const lastDeliveredId = id === '$' ? stream.lastId : id;

    stream.groups.set(group, {
      name: group,
      lastDeliveredId,
      entriesRead: stream.entries.length,
      consumers: new Map(),
      pending: [],
    });

    return 'OK';
  },

async xgroupDestroy(key: string, group: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) return 0;

    return stream.groups.delete(group) ? 1 : 0;
  },

async xgroupCreateconsumer(key: string, group: string, consumer: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    const grp = stream.groups.get(group);
    if (!grp) throw new Error('ERR no such consumer group');

    if (grp.consumers.has(consumer)) return 0;

    grp.consumers.set(consumer, {
      name: consumer,
      seenTime: Date.now(),
      pendingCount: 0,
      lastDeliveredId: '0-0',
      lastAckTime: 0,
    });

    return 1;
  },

async xgroupDelconsumer(key: string, group: string, consumer: string): Promise<number> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    const grp = stream.groups.get(group);
    if (!grp) throw new Error('ERR no such consumer group');

    const c = grp.consumers.get(consumer);
    if (!c) return 0;

    // Count pending entries for this consumer in this group
    const pendingCount = grp.pending.filter(p => p.consumer === consumer).length;

    // Remove consumer
    grp.consumers.delete(consumer);

    // Remove pending entries for this consumer
    grp.pending = grp.pending.filter(p => p.consumer !== consumer);

    return pendingCount;
  },

async xgroupSetid(key: string, group: string, id: string): Promise<string> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    const grp = stream.groups.get(group);
    if (!grp) throw new Error('ERR no such consumer group');

    grp.lastDeliveredId = id === '$' ? stream.lastId : id;
    return 'OK';
  },

async xreadgroup(group: string, consumer: string, keys: string[], ids: string[], count?: number, noack?: boolean): Promise<Array<{ key: string; entries: StreamEntry[] }> | null> {
    const results: Array<{ key: string; entries: StreamEntry[] }> = [];

    for (let i = 0; i < keys.length; i++) {
      this.evictIfExpired(keys[i]);
      this._ensureStreamTypeOrThrow(keys[i]);

      const stream = this.streamStore.get(keys[i]);
      if (!stream) continue;

      const grp = stream.groups.get(group);
      if (!grp) continue;

      // Ensure consumer exists
      if (!grp.consumers.has(consumer)) {
        grp.consumers.set(consumer, {
          name: consumer,
          seenTime: Date.now(),
          pendingCount: 0,
          lastDeliveredId: '0-0',
          lastAckTime: 0,
        });
      }

      const c = grp.consumers.get(consumer)!;
      c.seenTime = Date.now();

      const idArg = ids[i];

      if (idArg === '>') {
        // New entries: deliver entries after the group's lastDeliveredId
        const entries: StreamEntry[] = [];
        for (const entry of stream.entries) {
          if (this._compareStreamId(entry.id, grp.lastDeliveredId) > 0) {
            entries.push(entry);
            if (count !== undefined && entries.length >= count) break;
          }
        }

        // Mark as pending
        for (const entry of entries) {
          if (!noack) {
            grp.pending.push({
              id: entry.id,
              consumer,
              group,
              deliveredTime: Date.now(),
              deliveryCount: 1,
              lastDeliveredTime: Date.now(),
            });
          }
          c.pendingCount++;
        }

        // Update group's lastDeliveredId
        if (entries.length > 0) {
          grp.lastDeliveredId = entries[entries.length - 1].id;
          grp.entriesRead += entries.length;
        }

        c.lastDeliveredId = grp.lastDeliveredId;

        if (entries.length > 0) {
          results.push({ key: keys[i], entries });
        }
      } else {
        // Pending entries for this consumer: deliver entries with id > specified id
        // that are in the pending list for this consumer
        const startId = idArg === '0' ? '0-0' : idArg;
        const entries: StreamEntry[] = [];

        for (const pending of grp.pending) {
          if (pending.consumer === consumer && this._compareStreamId(pending.id, startId) > 0) {
            const streamEntry = stream.entries.find(e => e.id === pending.id);
            if (streamEntry) {
              entries.push(streamEntry);
              if (count !== undefined && entries.length >= count) break;
            }
          }
        }

        c.lastDeliveredId = entries.length > 0 ? entries[entries.length - 1].id : c.lastDeliveredId;

        if (entries.length > 0) {
          results.push({ key: keys[i], entries });
        }
      }
    }

    return results.length > 0 ? results : null;
  },

async xack(key: string, group: string, ids: string[]): Promise<number> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) return 0;

    const grp = stream.groups.get(group);
    if (!grp) return 0;

    let acknowledged = 0;
    const idSet = new Set(ids);

    // Remove from pending
    const originalLength = grp.pending.length;
    grp.pending = grp.pending.filter(p => {
      if (idSet.has(p.id)) {
        acknowledged++;
        // Decrement consumer's pending count
        const c = grp.consumers.get(p.consumer);
        if (c) {
          c.pendingCount = Math.max(0, c.pendingCount - 1);
        }
        return false;
      }
      return true;
    });

    return acknowledged;
  },

async xpending(key: string, group: string, options?: { start?: string; end?: string; count?: number; consumer?: string; idle?: number }): Promise<PendingEntry[] | { count: number; minId: string | null; maxId: string | null; consumers: Array<{ name: string; pending: number }> }> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    const grp = stream.groups.get(group);
    if (!grp) throw new Error('ERR no such consumer group');

    if (options?.start !== undefined || options?.end !== undefined || options?.idle !== undefined) {
      // Detailed mode
      let pending = grp.pending;

      // Filter by idle time
      if (options?.idle !== undefined) {
        const now = Date.now();
        const minIdle = options.idle;
        pending = pending.filter(p => now - p.deliveredTime > minIdle);
      }

      // Filter by ID range
      if (options?.start !== undefined && options?.end !== undefined) {
        const startId = options.start === '-' ? '0-0' : options.start;
        const endId = options.end === '+' ? '9999999999999-9999' : options.end;
        pending = pending.filter(p => {
          return this._compareStreamId(p.id, startId) >= 0 && this._compareStreamId(p.id, endId) <= 0;
        });
      }

      // Filter by consumer
      if (options?.consumer) {
        pending = pending.filter(p => p.consumer === options.consumer);
      }

      // Apply count limit
      if (options?.count !== undefined) {
        pending = pending.slice(0, options.count);
      }

      return pending;
    }

    // Summary mode
    const consumerMap = new Map<string, number>();
    for (const p of grp.pending) {
      consumerMap.set(p.consumer, (consumerMap.get(p.consumer) ?? 0) + 1);
    }

    const consumers = Array.from(consumerMap.entries()).map(([name, pending]) => ({ name, pending }));

    return {
      count: grp.pending.length,
      minId: grp.pending.length > 0 ? grp.pending.reduce((min, p) => this._compareStreamId(p.id, min) < 0 ? p.id : min, grp.pending[0].id) : null,
      maxId: grp.pending.length > 0 ? grp.pending.reduce((max, p) => this._compareStreamId(p.id, max) > 0 ? p.id : max, grp.pending[0].id) : null,
      consumers,
    };
  },

async xclaim(key: string, group: string, consumer: string, minIdleTime: number, ids: string[], options?: { idle?: number; time?: number; retrycount?: number; force?: boolean; justid?: boolean }): Promise<StreamEntry[] | string[]> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    const grp = stream.groups.get(group);
    if (!grp) throw new Error('ERR no such consumer group');

    const now = Date.now();
    const entries: StreamEntry[] = [];
    const claimedIds: string[] = [];

    // Ensure new consumer exists
    if (!grp.consumers.has(consumer)) {
      grp.consumers.set(consumer, {
        name: consumer,
        seenTime: now,
        pendingCount: 0,
        lastDeliveredId: '0-0',
        lastAckTime: 0,
      });
    }

    for (const id of ids) {
      const pendingIdx = grp.pending.findIndex(p => p.id === id);
      if (pendingIdx === -1) {
        if (options?.force) {
          // Force create pending entry even if not found
          const entry = stream.entries.find(e => e.id === id);
          if (entry) {
            const newPending: PendingEntry = {
              id,
              consumer,
              group,
              deliveredTime: options?.time ?? now,
              deliveryCount: 1,
              lastDeliveredTime: options?.time ?? now,
            };
            grp.pending.push(newPending);
            entries.push(entry);
            claimedIds.push(id);
            grp.consumers.get(consumer)!.pendingCount++;
          }
        }
        continue;
      }

      const pending = grp.pending[pendingIdx];
      const idleTime = now - pending.deliveredTime;

      if (idleTime < minIdleTime) continue;

      // Transfer from old consumer to new
      const oldConsumer = grp.consumers.get(pending.consumer);
      if (oldConsumer) {
        oldConsumer.pendingCount = Math.max(0, oldConsumer.pendingCount - 1);
      }

      // Update pending entry
      pending.consumer = consumer;
      pending.deliveryCount = options?.retrycount ?? pending.deliveryCount + 1;

      if (options?.idle !== undefined) {
        pending.deliveredTime = now - options.idle;
      } else if (options?.time !== undefined) {
        pending.deliveredTime = options.time;
      } else {
        pending.deliveredTime = now;
      }
      pending.lastDeliveredTime = pending.deliveredTime;

      grp.consumers.get(consumer)!.pendingCount++;

      const entry = stream.entries.find(e => e.id === id);
      if (entry) {
        entries.push(entry);
      }
      claimedIds.push(id);
    }

    if (options?.justid) {
      return claimedIds;
    }

    return entries;
  },

async xautoclaim(key: string, group: string, consumer: string, minIdleTime: number, start: string, options?: { count?: number; justid?: boolean }): Promise<{ nextStartId: string; entries: StreamEntry[] | string[] }> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    const grp = stream.groups.get(group);
    if (!grp) throw new Error('ERR no such consumer group');

    const now = Date.now();
    const startId = start === '-' ? '0-0' : start;

    // Ensure new consumer exists
    if (!grp.consumers.has(consumer)) {
      grp.consumers.set(consumer, {
        name: consumer,
        seenTime: now,
        pendingCount: 0,
        lastDeliveredId: '0-0',
        lastAckTime: 0,
      });
    }

    const effectiveCount = options?.count ?? 100;
    const claimedEntries: StreamEntry[] = [];
    const claimedIds: string[] = [];
    let nextStartId = '0-0';

    // Sort pending by ID for scanning
    const sortedPending = [...grp.pending].sort((a, b) => this._compareStreamId(a.id, b.id));

    let count = 0;
    for (const pending of sortedPending) {
      if (count >= effectiveCount) {
        nextStartId = pending.id;
        break;
      }

      if (this._compareStreamId(pending.id, startId) < 0) continue;

      const idleTime = now - pending.deliveredTime;
      if (idleTime >= minIdleTime) {
        // Transfer to new consumer
        const oldConsumer = grp.consumers.get(pending.consumer);
        if (oldConsumer) {
          oldConsumer.pendingCount = Math.max(0, oldConsumer.pendingCount - 1);
        }

        pending.consumer = consumer;
        pending.deliveryCount++;
        pending.deliveredTime = now;
        pending.lastDeliveredTime = now;
        grp.consumers.get(consumer)!.pendingCount++;

        const entry = stream.entries.find(e => e.id === pending.id);
        if (entry) {
          claimedEntries.push(entry);
        }
        claimedIds.push(pending.id);
        count++;
      }
    }

    return {
      nextStartId,
      entries: options?.justid ? claimedIds : claimedEntries,
    };
  },

async xinfoStream(key: string): Promise<StreamInfo> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    return {
      length: stream.entries.length,
      firstEntry: stream.entries.length > 0 ? stream.entries[0] : null,
      lastEntry: stream.entries.length > 0 ? stream.entries[stream.entries.length - 1] : null,
      maxDeletedEntryId: stream.maxDeletedId,
      entriesAdded: stream.entriesAdded,
      recordedFirstEntryId: stream.recordedFirstId,
      groups: stream.groups.size,
    };
  },

async xinfoGroups(key: string): Promise<GroupInfo[]> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    const result: GroupInfo[] = [];
    for (const [name, grp] of stream.groups) {
      result.push({
        name,
        consumers: grp.consumers.size,
        pending: grp.pending.length,
        lastDeliveredId: grp.lastDeliveredId,
        entriesRead: grp.entriesRead,
        lag: stream.entries.length - grp.entriesRead,
      });
    }
    return result;
  },

async xinfoConsumers(key: string, group: string): Promise<StreamConsumer[]> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    const grp = stream.groups.get(group);
    if (!grp) throw new Error('ERR no such consumer group');

    const now = Date.now();
    const result: StreamConsumer[] = [];
    for (const [name, c] of grp.consumers) {
      result.push({
        name: c.name,
        pendingCount: c.pendingCount,
        idleTime: now - c.seenTime,
        lastDeliveredId: c.lastDeliveredId,
        lastAckTime: c.lastAckTime,
      });
    }
    return result;
  },

async xsetid(key: string, id: string): Promise<string> {
    this.evictIfExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const stream = this.streamStore.get(key);
    if (!stream) throw new Error('ERR no such key');

    stream.lastId = id;
    return 'OK';
  },

};
