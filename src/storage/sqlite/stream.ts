// @ts-nocheck
import { assertType, assertTypeOneOf, WRONGTYPE_ERROR } from '../type-check';
import type { SqliteStorage } from './core';

export const streamMethods = {
  _parseStreamId(id: string): { ms: number; seq: number } {
    if (id === '-' || id === '0-0') return { ms: 0, seq: 0 };
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
    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as
      | { last_id: string }
      | undefined;
    const lastId = metaRow ? metaRow.last_id : '0-0';

    if (id === '*') {
      const now = Date.now();
      const lastParsed = this._parseStreamId(lastId);
      if (now > lastParsed.ms) {
        return this._formatStreamId(now, 0);
      } else {
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
        return null;
      }
    }

    // Explicit id
    if (this._compareStreamId(id, lastId) <= 0) {
      return null;
    }
    return id;
  },

  _ensureStreamTypeOrThrow(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as
      | { type: string }
      | undefined;
    assertType(row?.type, 'stream');
  },

  _ensureStreamKvStoreEntry(key: string): void {
    const row = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as
      | { type: string }
      | undefined;
    assertType(row?.type, 'stream');
    if (!row) {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO kv_store (key, value, type, expires_at) VALUES (?, '', 'stream', NULL)"
        )
        .run(key);
    }
  },

  _cleanupStreamIfEmpty(key: string): void {
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as
      | { type: string }
      | undefined;
    if (!typeRow || typeRow.type !== 'stream') return;
    const cntRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?')
      .get(key) as { cnt: number };
    const grpCntRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_groups WHERE key = ?')
      .get(key) as { cnt: number };
    if (cntRow.cnt === 0 && grpCntRow.cnt === 0) {
      this.db.prepare('DELETE FROM stream_entries WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_meta WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_consumers WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM stream_pending WHERE key = ?').run(key);
      this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }
  },

  async xadd(
    key: string,
    id: string,
    fields: Record<string, string>,
    options?: { maxlen?: number; approx?: boolean; minid?: string; nomkstream?: boolean }
  ): Promise<string | null> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    if (options?.nomkstream) {
      const row = this.db.prepare('SELECT 1 FROM kv_store WHERE key = ?').get(key);
      if (!row) return null;
    }

    this._ensureStreamKvStoreEntry(key);

    const generatedId = this._generateStreamId(key, id);
    if (generatedId === null) {
      throw new Error(
        'ERR The ID specified in XADD is equal or smaller than the target stream top item'
      );
    }

    const now = Date.now();
    const fieldsJson = JSON.stringify(fields);

    const tx = this.db.transaction(() => {
      // Insert entry
      this.db
        .prepare(
          'INSERT OR REPLACE INTO stream_entries (key, id, fields, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(key, generatedId, fieldsJson, now);

      // Update stream metadata
      const metaRow = this.db
        .prepare('SELECT last_id, entries_added, recorded_first_id FROM stream_meta WHERE key = ?')
        .get(key) as
        | { last_id: string; entries_added: number; recorded_first_id: string }
        | undefined;
      if (metaRow) {
        this.db
          .prepare('UPDATE stream_meta SET last_id = ?, entries_added = ? WHERE key = ?')
          .run(generatedId, metaRow.entries_added + 1, key);
      } else {
        this.db
          .prepare(
            "INSERT OR REPLACE INTO stream_meta (key, last_id, max_deleted_id, entries_added, recorded_first_id) VALUES (?, ?, '0-0', 1, ?)"
          )
          .run(key, generatedId, generatedId);
      }

      // Handle trimming
      if (options?.maxlen !== undefined) {
        this._xtrimInternal(key, 'MAXLEN', options.maxlen, options.approx ?? false);
      } else if (options?.minid !== undefined) {
        this._xtrimInternal(key, 'MINID', options.minid, options.approx ?? false);
      }
    });

    tx();
    return generatedId;
  },

  _xtrimInternal(
    key: string,
    strategy: 'MAXLEN' | 'MINID',
    threshold: string | number,
    approx: boolean,
    limit?: number
  ): number {
    const cntRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?')
      .get(key) as { cnt: number };
    if (cntRow.cnt === 0) return 0;

    let removeCount = 0;

    if (strategy === 'MAXLEN') {
      const maxLen = typeof threshold === 'number' ? threshold : parseInt(String(threshold), 10);
      if (cntRow.cnt <= maxLen) return 0;
      removeCount = cntRow.cnt - maxLen;
      if (limit !== undefined && removeCount > limit) removeCount = limit;

      // Get the IDs to remove
      const rows = this.db
        .prepare('SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT ?')
        .all(key, removeCount) as { id: string }[];

      for (const row of rows) {
        this.db.prepare('DELETE FROM stream_entries WHERE key = ? AND id = ?').run(key, row.id);
      }

      // Update max_deleted_id and recorded_first_id
      if (rows.length > 0) {
        const metaRow = this.db
          .prepare('SELECT max_deleted_id, recorded_first_id FROM stream_meta WHERE key = ?')
          .get(key) as { max_deleted_id: string; recorded_first_id: string } | undefined;
        if (metaRow) {
          const lastDeletedId = rows[rows.length - 1].id;
          const newMaxDeletedId =
            this._compareStreamId(metaRow.max_deleted_id, lastDeletedId) > 0
              ? metaRow.max_deleted_id
              : lastDeletedId;
          this.db
            .prepare('UPDATE stream_meta SET max_deleted_id = ? WHERE key = ?')
            .run(newMaxDeletedId, key);
          // Update recorded_first_id
          const firstRow = this.db
            .prepare('SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT 1')
            .get(key) as { id: string } | undefined;
          if (firstRow) {
            this.db
              .prepare('UPDATE stream_meta SET recorded_first_id = ? WHERE key = ?')
              .run(firstRow.id, key);
          }
        }
      }
    } else {
      // MINID strategy
      const minId = String(threshold);
      // Find entries with ID < minId
      const rows = this.db
        .prepare('SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC')
        .all(key) as { id: string }[];

      const toRemove: string[] = [];
      for (const row of rows) {
        if (this._compareStreamId(row.id, minId) < 0) {
          toRemove.push(row.id);
        } else {
          break;
        }
      }

      removeCount = toRemove.length;
      if (limit !== undefined && removeCount > limit) removeCount = limit;

      for (let i = 0; i < removeCount; i++) {
        this.db
          .prepare('DELETE FROM stream_entries WHERE key = ? AND id = ?')
          .run(key, toRemove[i]);
      }

      // Update max_deleted_id and recorded_first_id
      if (removeCount > 0) {
        const metaRow = this.db
          .prepare('SELECT max_deleted_id FROM stream_meta WHERE key = ?')
          .get(key) as { max_deleted_id: string } | undefined;
        if (metaRow) {
          const lastDeletedId = toRemove[removeCount - 1];
          const newMaxDeletedId =
            this._compareStreamId(metaRow.max_deleted_id, lastDeletedId) > 0
              ? metaRow.max_deleted_id
              : lastDeletedId;
          this.db
            .prepare('UPDATE stream_meta SET max_deleted_id = ? WHERE key = ?')
            .run(newMaxDeletedId, key);
        }
        const firstRow = this.db
          .prepare('SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT 1')
          .get(key) as { id: string } | undefined;
        if (firstRow) {
          this.db
            .prepare('UPDATE stream_meta SET recorded_first_id = ? WHERE key = ?')
            .run(firstRow.id, key);
        }
      }
    }

    return removeCount;
  },

  async xtrim(
    key: string,
    strategy: 'MAXLEN' | 'MINID',
    threshold: string | number,
    approx?: boolean,
    limit?: number
  ): Promise<number> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    return this._xtrimInternal(key, strategy, threshold, approx ?? false, limit);
  },

  async xdel(key: string, ids: string[]): Promise<number> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    let removed = 0;
    const tx = this.db.transaction(() => {
      for (const id of ids) {
        const result = this.db
          .prepare('DELETE FROM stream_entries WHERE key = ? AND id = ?')
          .run(key, id);
        if (result.changes > 0) {
          removed++;
          // Update max_deleted_id
          const metaRow = this.db
            .prepare('SELECT max_deleted_id FROM stream_meta WHERE key = ?')
            .get(key) as { max_deleted_id: string } | undefined;
          if (metaRow && this._compareStreamId(id, metaRow.max_deleted_id) > 0) {
            this.db.prepare('UPDATE stream_meta SET max_deleted_id = ? WHERE key = ?').run(id, key);
          }
        }
      }
      // Update recorded_first_id
      const firstRow = this.db
        .prepare('SELECT id FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT 1')
        .get(key) as { id: string } | undefined;
      if (firstRow) {
        this.db
          .prepare('UPDATE stream_meta SET recorded_first_id = ? WHERE key = ?')
          .run(firstRow.id, key);
      }
      this._cleanupStreamIfEmpty(key);
    });

    tx();
    return removed;
  },

  async xrange(key: string, start: string, end: string, count?: number): Promise<StreamEntry[]> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as
      | { last_id: string }
      | undefined;
    if (!metaRow) return [];

    const startId = start === '-' ? '0-0' : start;
    const endId = end === '+' ? metaRow.last_id : end;

    let sql =
      'SELECT id, fields, created_at FROM stream_entries WHERE key = ? AND id >= ? AND id <= ? ORDER BY id ASC';
    const params: any[] = [key, startId, endId];

    if (count !== undefined && count > 0) {
      sql += ' LIMIT ?';
      params.push(count);
    }

    const rows = this.db.prepare(sql).all(...params) as {
      id: string;
      fields: string;
      created_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      fields: JSON.parse(r.fields),
      createdAt: r.created_at,
    }));
  },

  async xrevrange(key: string, end: string, start: string, count?: number): Promise<StreamEntry[]> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as
      | { last_id: string }
      | undefined;
    if (!metaRow) return [];

    const startId = start === '-' ? '0-0' : start;
    const endId = end === '+' ? metaRow.last_id : end;

    let sql =
      'SELECT id, fields, created_at FROM stream_entries WHERE key = ? AND id >= ? AND id <= ? ORDER BY id DESC';
    const params: any[] = [key, startId, endId];

    if (count !== undefined && count > 0) {
      sql += ' LIMIT ?';
      params.push(count);
    }

    const rows = this.db.prepare(sql).all(...params) as {
      id: string;
      fields: string;
      created_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      fields: JSON.parse(r.fields),
      createdAt: r.created_at,
    }));
  },

  async xlen(key: string): Promise<number> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?')
      .get(key) as { cnt: number };
    return row.cnt;
  },

  async xread(
    keys: string[],
    ids: string[],
    count?: number
  ): Promise<Array<{ key: string; entries: StreamEntry[] }> | null> {
    for (let i = 0; i < keys.length; i++) {
      this.evictExpired(keys[i]);
    }
    for (const k of keys) this._ensureStreamTypeOrThrow(k);

    const results: Array<{ key: string; entries: StreamEntry[] }> = [];

    for (let i = 0; i < keys.length; i++) {
      const metaRow = this.db
        .prepare('SELECT last_id FROM stream_meta WHERE key = ?')
        .get(keys[i]) as { last_id: string } | undefined;
      if (!metaRow) continue;

      const startId = ids[i] === '$' ? metaRow.last_id : ids[i];

      let sql =
        'SELECT id, fields, created_at FROM stream_entries WHERE key = ? AND id > ? ORDER BY id ASC';
      const params: any[] = [keys[i], startId];
      if (count !== undefined && count > 0) {
        sql += ' LIMIT ?';
        params.push(count);
      }

      const rows = this.db.prepare(sql).all(...params) as {
        id: string;
        fields: string;
        created_at: number;
      }[];
      if (rows.length > 0) {
        results.push({
          key: keys[i],
          entries: rows.map((r) => ({
            id: r.id,
            fields: JSON.parse(r.fields),
            createdAt: r.created_at,
          })),
        });
      }
    }

    return results.length > 0 ? results : null;
  },

  async xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<string> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    if (mkstream) {
      this._ensureStreamKvStoreEntry(key);
      // Ensure meta exists
      const metaRow = this.db.prepare('SELECT 1 FROM stream_meta WHERE key = ?').get(key);
      if (!metaRow) {
        this.db
          .prepare(
            "INSERT OR REPLACE INTO stream_meta (key, last_id, max_deleted_id, entries_added, recorded_first_id) VALUES (?, '0-0', '0-0', 0, '0-0')"
          )
          .run(key);
      }
    }

    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as
      | { last_id: string }
      | undefined;
    if (!metaRow) {
      throw new Error('ERR no such key');
    }

    const existingGroup = this.db
      .prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?')
      .get(key, group);
    if (existingGroup) {
      throw new Error('BUSYGROUP Consumer Group name already exists');
    }

    const lastDeliveredId = id === '$' ? metaRow.last_id : id;
    const cntRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?')
      .get(key) as { cnt: number };

    this.db
      .prepare(
        'INSERT INTO stream_groups (key, group_name, last_delivered_id, entries_read) VALUES (?, ?, ?, ?)'
      )
      .run(key, group, lastDeliveredId, cntRow.cnt);

    return 'OK';
  },

  async xgroupDestroy(key: string, group: string): Promise<number> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    // Check if key exists as stream
    const typeRow = this.db.prepare('SELECT type FROM kv_store WHERE key = ?').get(key) as
      | { type: string }
      | undefined;
    if (!typeRow) return 0;

    const result = this.db
      .prepare('DELETE FROM stream_groups WHERE key = ? AND group_name = ?')
      .run(key, group);
    // Also delete consumers and pending for this group
    this.db
      .prepare('DELETE FROM stream_consumers WHERE key = ? AND group_name = ?')
      .run(key, group);
    this.db.prepare('DELETE FROM stream_pending WHERE key = ? AND group_name = ?').run(key, group);

    return result.changes > 0 ? 1 : 0;
  },

  async xgroupCreateconsumer(key: string, group: string, consumer: string): Promise<number> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const grpRow = this.db
      .prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?')
      .get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    const existing = this.db
      .prepare(
        'SELECT 1 FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?'
      )
      .get(key, group, consumer);
    if (existing) return 0;

    this.db
      .prepare(
        "INSERT INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) VALUES (?, ?, ?, 0, 0, '0-0', 0, ?)"
      )
      .run(key, group, consumer, Date.now());
    return 1;
  },

  async xgroupDelconsumer(key: string, group: string, consumer: string): Promise<number> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const grpRow = this.db
      .prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?')
      .get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    // Count pending entries for this consumer in this group
    const pendingCnt = this.db
      .prepare(
        'SELECT COUNT(*) as cnt FROM stream_pending WHERE key = ? AND group_name = ? AND consumer_name = ?'
      )
      .get(key, group, consumer) as { cnt: number };

    // Delete consumer and their pending entries
    this.db
      .prepare(
        'DELETE FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?'
      )
      .run(key, group, consumer);
    this.db
      .prepare('DELETE FROM stream_pending WHERE key = ? AND group_name = ? AND consumer_name = ?')
      .run(key, group, consumer);

    return pendingCnt.cnt;
  },

  async xgroupSetid(key: string, group: string, id: string): Promise<string> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT last_id FROM stream_meta WHERE key = ?').get(key) as
      | { last_id: string }
      | undefined;
    if (!metaRow) throw new Error('ERR no such key');

    const grpRow = this.db
      .prepare('SELECT last_delivered_id FROM stream_groups WHERE key = ? AND group_name = ?')
      .get(key, group) as { last_delivered_id: string } | undefined;
    if (!grpRow) throw new Error('ERR no such consumer group');

    const lastDeliveredId = id === '$' ? metaRow.last_id : id;
    this.db
      .prepare('UPDATE stream_groups SET last_delivered_id = ? WHERE key = ? AND group_name = ?')
      .run(lastDeliveredId, key, group);
    return 'OK';
  },

  async xreadgroup(
    group: string,
    consumer: string,
    keys: string[],
    ids: string[],
    count?: number,
    noack?: boolean
  ): Promise<Array<{ key: string; entries: StreamEntry[] }> | null> {
    for (let i = 0; i < keys.length; i++) {
      this.evictExpired(keys[i]);
    }
    for (const k of keys) this._ensureStreamTypeOrThrow(k);

    const results: Array<{ key: string; entries: StreamEntry[] }> = [];
    const now = Date.now();

    for (let i = 0; i < keys.length; i++) {
      const metaRow = this.db
        .prepare('SELECT last_id FROM stream_meta WHERE key = ?')
        .get(keys[i]) as { last_id: string } | undefined;
      if (!metaRow) continue;

      const grpRow = this.db
        .prepare(
          'SELECT last_delivered_id, entries_read FROM stream_groups WHERE key = ? AND group_name = ?'
        )
        .get(keys[i], group) as { last_delivered_id: string; entries_read: number } | undefined;
      if (!grpRow) continue;

      // Ensure consumer exists
      const consumerRow = this.db
        .prepare(
          'SELECT 1 FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?'
        )
        .get(keys[i], group, consumer);
      if (!consumerRow) {
        this.db
          .prepare(
            "INSERT INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) VALUES (?, ?, ?, 0, 0, '0-0', 0, ?)"
          )
          .run(keys[i], group, consumer, now);
      } else {
        this.db
          .prepare(
            'UPDATE stream_consumers SET seen_time = ? WHERE key = ? AND group_name = ? AND consumer_name = ?'
          )
          .run(now, keys[i], group, consumer);
      }

      const idArg = ids[i];

      if (idArg === '>') {
        // New entries: deliver entries after the group's lastDeliveredId
        let sql =
          'SELECT id, fields, created_at FROM stream_entries WHERE key = ? AND id > ? ORDER BY id ASC';
        const params: any[] = [keys[i], grpRow.last_delivered_id];
        if (count !== undefined && count > 0) {
          sql += ' LIMIT ?';
          params.push(count);
        }

        const rows = this.db.prepare(sql).all(...params) as {
          id: string;
          fields: string;
          created_at: number;
        }[];
        const entries: StreamEntry[] = rows.map((r) => ({
          id: r.id,
          fields: JSON.parse(r.fields),
          createdAt: r.created_at,
        }));

        // Mark as pending
        if (!noack) {
          for (const entry of entries) {
            this.db
              .prepare(
                'INSERT OR REPLACE INTO stream_pending (key, id, group_name, consumer_name, delivered_time, delivery_count, last_delivered_time) VALUES (?, ?, ?, ?, ?, 1, ?)'
              )
              .run(keys[i], entry.id, group, consumer, now, now);
          }
        }

        // Update consumer pending count
        if (entries.length > 0) {
          this.db
            .prepare(
              'UPDATE stream_consumers SET pending_count = pending_count + ?, last_delivered_id = ? WHERE key = ? AND group_name = ? AND consumer_name = ?'
            )
            .run(entries.length, entries[entries.length - 1].id, keys[i], group, consumer);

          // Update group's lastDeliveredId
          this.db
            .prepare(
              'UPDATE stream_groups SET last_delivered_id = ?, entries_read = entries_read + ? WHERE key = ? AND group_name = ?'
            )
            .run(entries[entries.length - 1].id, entries.length, keys[i], group);
        }

        if (entries.length > 0) {
          results.push({ key: keys[i], entries });
        }
      } else {
        // Pending entries for this consumer: deliver entries with id > specified id
        const startId = idArg === '0' ? '0-0' : idArg;
        let sql =
          'SELECT sp.id, se.fields, se.created_at FROM stream_pending sp LEFT JOIN stream_entries se ON sp.key = se.key AND sp.id = se.id WHERE sp.key = ? AND sp.group_name = ? AND sp.consumer_name = ? AND sp.id > ? ORDER BY sp.id ASC';
        const params: any[] = [keys[i], group, consumer, startId];
        if (count !== undefined && count > 0) {
          sql += ' LIMIT ?';
          params.push(count);
        }

        const rows = this.db.prepare(sql).all(...params) as {
          id: string;
          fields: string | null;
          created_at: number | null;
        }[];
        const entries: StreamEntry[] = [];
        for (const r of rows) {
          if (r.fields !== null) {
            entries.push({
              id: r.id,
              fields: JSON.parse(r.fields),
              createdAt: r.created_at ?? 0,
            });
          }
        }

        if (entries.length > 0) {
          this.db
            .prepare(
              'UPDATE stream_consumers SET last_delivered_id = ? WHERE key = ? AND group_name = ? AND consumer_name = ?'
            )
            .run(entries[entries.length - 1].id, keys[i], group, consumer);
          results.push({ key: keys[i], entries });
        }
      }
    }

    return results.length > 0 ? results : null;
  },

  async xack(key: string, group: string, ids: string[]): Promise<number> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    let acknowledged = 0;
    const tx = this.db.transaction(() => {
      for (const id of ids) {
        const row = this.db
          .prepare(
            'SELECT consumer_name FROM stream_pending WHERE key = ? AND group_name = ? AND id = ?'
          )
          .get(key, group, id) as { consumer_name: string } | undefined;

        if (row) {
          this.db
            .prepare('DELETE FROM stream_pending WHERE key = ? AND group_name = ? AND id = ?')
            .run(key, group, id);

          // Decrement consumer's pending count
          this.db
            .prepare(
              'UPDATE stream_consumers SET pending_count = MAX(0, pending_count - 1) WHERE key = ? AND group_name = ? AND consumer_name = ?'
            )
            .run(key, group, row.consumer_name);

          acknowledged++;
        }
      }
    });
    tx();
    return acknowledged;
  },

  async xpending(
    key: string,
    group: string,
    options?: { start?: string; end?: string; count?: number; consumer?: string; idle?: number }
  ): Promise<
    | PendingEntry[]
    | {
        count: number;
        minId: string | null;
        maxId: string | null;
        consumers: Array<{ name: string; pending: number }>;
      }
  > {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const grpRow = this.db
      .prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?')
      .get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    if (options?.start !== undefined || options?.end !== undefined || options?.idle !== undefined) {
      // Detailed mode
      let sql =
        'SELECT id, consumer_name, group_name, delivered_time, delivery_count, last_delivered_time FROM stream_pending WHERE key = ? AND group_name = ?';
      const params: any[] = [key, group];

      // Filter by idle time
      if (options?.idle !== undefined) {
        sql += ' AND (? - delivered_time) > ?';
        params.push(Date.now(), options.idle);
      }

      // Filter by ID range
      if (options?.start !== undefined && options?.end !== undefined) {
        const startId = options.start === '-' ? '0-0' : options.start;
        const endId = options.end === '+' ? '9999999999999-9999' : options.end;
        sql += ' AND id >= ? AND id <= ?';
        params.push(startId, endId);
      }

      // Filter by consumer
      if (options?.consumer) {
        sql += ' AND consumer_name = ?';
        params.push(options.consumer);
      }

      sql += ' ORDER BY id ASC';

      if (options?.count !== undefined) {
        sql += ' LIMIT ?';
        params.push(options.count);
      }

      const rows = this.db.prepare(sql).all(...params) as {
        id: string;
        consumer_name: string;
        group_name: string;
        delivered_time: number;
        delivery_count: number;
        last_delivered_time: number;
      }[];
      return rows.map((r) => ({
        id: r.id,
        consumer: r.consumer_name,
        group: r.group_name,
        deliveredTime: r.delivered_time,
        deliveryCount: r.delivery_count,
        lastDeliveredTime: r.last_delivered_time,
      }));
    }

    // Summary mode
    const cntRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_pending WHERE key = ? AND group_name = ?')
      .get(key, group) as { cnt: number };

    const minRow = this.db
      .prepare('SELECT MIN(id) as min_id FROM stream_pending WHERE key = ? AND group_name = ?')
      .get(key, group) as { min_id: string | null };

    const maxRow = this.db
      .prepare('SELECT MAX(id) as max_id FROM stream_pending WHERE key = ? AND group_name = ?')
      .get(key, group) as { max_id: string | null };

    const consumerRows = this.db
      .prepare(
        'SELECT consumer_name, COUNT(*) as pending FROM stream_pending WHERE key = ? AND group_name = ? GROUP BY consumer_name'
      )
      .all(key, group) as { consumer_name: string; pending: number }[];

    return {
      count: cntRow.cnt,
      minId: minRow.min_id,
      maxId: maxRow.max_id,
      consumers: consumerRows.map((r) => ({ name: r.consumer_name, pending: r.pending })),
    };
  },

  async xclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    ids: string[],
    options?: {
      idle?: number;
      time?: number;
      retrycount?: number;
      force?: boolean;
      justid?: boolean;
    }
  ): Promise<StreamEntry[] | string[]> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const grpRow = this.db
      .prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?')
      .get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    const now = Date.now();
    const entries: StreamEntry[] = [];
    const claimedIds: string[] = [];

    // Ensure new consumer exists
    const consumerRow = this.db
      .prepare(
        'SELECT 1 FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?'
      )
      .get(key, group, consumer);
    if (!consumerRow) {
      this.db
        .prepare(
          "INSERT INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) VALUES (?, ?, ?, 0, 0, '0-0', 0, ?)"
        )
        .run(key, group, consumer, now);
    }

    const tx = this.db.transaction(() => {
      for (const id of ids) {
        const pendingRow = this.db
          .prepare(
            'SELECT consumer_name, delivered_time, delivery_count FROM stream_pending WHERE key = ? AND group_name = ? AND id = ?'
          )
          .get(key, group, id) as
          | { consumer_name: string; delivered_time: number; delivery_count: number }
          | undefined;

        if (!pendingRow) {
          if (options?.force) {
            // Force create pending entry
            const entryRow = this.db
              .prepare('SELECT fields, created_at FROM stream_entries WHERE key = ? AND id = ?')
              .get(key, id) as { fields: string; created_at: number } | undefined;
            if (entryRow) {
              this.db
                .prepare(
                  'INSERT OR REPLACE INTO stream_pending (key, id, group_name, consumer_name, delivered_time, delivery_count, last_delivered_time) VALUES (?, ?, ?, ?, ?, 1, ?)'
                )
                .run(key, id, group, consumer, options?.time ?? now, options?.time ?? now);
              this.db
                .prepare(
                  'UPDATE stream_consumers SET pending_count = pending_count + 1 WHERE key = ? AND group_name = ? AND consumer_name = ?'
                )
                .run(key, group, consumer);
              entries.push({
                id,
                fields: JSON.parse(entryRow.fields),
                createdAt: entryRow.created_at,
              });
              claimedIds.push(id);
            }
          }
          continue;
        }

        const idleTime = now - pendingRow.delivered_time;
        if (idleTime < minIdleTime) continue;

        // Transfer from old consumer to new
        this.db
          .prepare(
            'UPDATE stream_consumers SET pending_count = MAX(0, pending_count - 1) WHERE key = ? AND group_name = ? AND consumer_name = ?'
          )
          .run(key, group, pendingRow.consumer_name);

        // Update pending entry
        const deliveryCount = options?.retrycount ?? pendingRow.delivery_count + 1;
        const deliveredTime =
          options?.idle !== undefined ? now - options.idle : (options?.time ?? now);

        this.db
          .prepare(
            'UPDATE stream_pending SET consumer_name = ?, delivered_time = ?, delivery_count = ?, last_delivered_time = ? WHERE key = ? AND group_name = ? AND id = ?'
          )
          .run(consumer, deliveredTime, deliveryCount, deliveredTime, key, group, id);

        this.db
          .prepare(
            'UPDATE stream_consumers SET pending_count = pending_count + 1, seen_time = ? WHERE key = ? AND group_name = ? AND consumer_name = ?'
          )
          .run(now, key, group, consumer);

        const entryRow = this.db
          .prepare('SELECT fields, created_at FROM stream_entries WHERE key = ? AND id = ?')
          .get(key, id) as { fields: string; created_at: number } | undefined;
        if (entryRow) {
          entries.push({ id, fields: JSON.parse(entryRow.fields), createdAt: entryRow.created_at });
        }
        claimedIds.push(id);
      }
    });
    tx();

    if (options?.justid) return claimedIds;
    return entries;
  },

  async xautoclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    start: string,
    options?: { count?: number; justid?: boolean }
  ): Promise<{ nextStartId: string; entries: StreamEntry[] | string[] }> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const grpRow = this.db
      .prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?')
      .get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    const now = Date.now();
    const startId = start === '-' ? '0-0' : start;
    const effectiveCount = options?.count ?? 100;

    // Ensure new consumer exists
    const consumerRow = this.db
      .prepare(
        'SELECT 1 FROM stream_consumers WHERE key = ? AND group_name = ? AND consumer_name = ?'
      )
      .get(key, group, consumer);
    if (!consumerRow) {
      this.db
        .prepare(
          "INSERT INTO stream_consumers (key, group_name, consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time) VALUES (?, ?, ?, 0, 0, '0-0', 0, ?)"
        )
        .run(key, group, consumer, now);
    }

    // Get pending entries that match idle time and start criteria
    const pendingRows = this.db
      .prepare(
        'SELECT id, consumer_name, delivered_time, delivery_count FROM stream_pending WHERE key = ? AND group_name = ? AND id >= ? ORDER BY id ASC'
      )
      .all(key, group, startId) as {
      id: string;
      consumer_name: string;
      delivered_time: number;
      delivery_count: number;
    }[];

    const claimedEntries: StreamEntry[] = [];
    const claimedIds: string[] = [];
    let nextStartId = '0-0';

    const tx = this.db.transaction(() => {
      let count = 0;
      for (const row of pendingRows) {
        if (count >= effectiveCount) {
          nextStartId = row.id;
          break;
        }

        const idleTime = now - row.delivered_time;
        if (idleTime >= minIdleTime) {
          // Transfer to new consumer
          this.db
            .prepare(
              'UPDATE stream_consumers SET pending_count = MAX(0, pending_count - 1) WHERE key = ? AND group_name = ? AND consumer_name = ?'
            )
            .run(key, group, row.consumer_name);

          this.db
            .prepare(
              'UPDATE stream_pending SET consumer_name = ?, delivered_time = ?, delivery_count = delivery_count + 1, last_delivered_time = ? WHERE key = ? AND group_name = ? AND id = ?'
            )
            .run(consumer, now, now, key, group, row.id);

          this.db
            .prepare(
              'UPDATE stream_consumers SET pending_count = pending_count + 1, seen_time = ? WHERE key = ? AND group_name = ? AND consumer_name = ?'
            )
            .run(now, key, group, consumer);

          const entryRow = this.db
            .prepare('SELECT fields, created_at FROM stream_entries WHERE key = ? AND id = ?')
            .get(key, row.id) as { fields: string; created_at: number } | undefined;
          if (entryRow) {
            claimedEntries.push({
              id: row.id,
              fields: JSON.parse(entryRow.fields),
              createdAt: entryRow.created_at,
            });
          }
          claimedIds.push(row.id);
          count++;
        }
      }
    });
    tx();

    return {
      nextStartId,
      entries: options?.justid ? claimedIds : claimedEntries,
    };
  },

  async xinfoStream(key: string): Promise<StreamInfo> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const metaRow = this.db
      .prepare(
        'SELECT last_id, max_deleted_id, entries_added, recorded_first_id FROM stream_meta WHERE key = ?'
      )
      .get(key) as
      | {
          last_id: string;
          max_deleted_id: string;
          entries_added: number;
          recorded_first_id: string;
        }
      | undefined;
    if (!metaRow) throw new Error('ERR no such key');

    const cntRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?')
      .get(key) as { cnt: number };
    const firstRow = this.db
      .prepare(
        'SELECT id, fields, created_at FROM stream_entries WHERE key = ? ORDER BY id ASC LIMIT 1'
      )
      .get(key) as { id: string; fields: string; created_at: number } | undefined;
    const lastRow = this.db
      .prepare(
        'SELECT id, fields, created_at FROM stream_entries WHERE key = ? ORDER BY id DESC LIMIT 1'
      )
      .get(key) as { id: string; fields: string; created_at: number } | undefined;
    const grpCntRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_groups WHERE key = ?')
      .get(key) as { cnt: number };

    const firstEntry = firstRow
      ? { id: firstRow.id, fields: JSON.parse(firstRow.fields), createdAt: firstRow.created_at }
      : null;
    const lastEntry = lastRow
      ? { id: lastRow.id, fields: JSON.parse(lastRow.fields), createdAt: lastRow.created_at }
      : null;

    return {
      length: cntRow.cnt,
      firstEntry,
      lastEntry,
      maxDeletedEntryId: metaRow.max_deleted_id,
      entriesAdded: metaRow.entries_added,
      recordedFirstEntryId: metaRow.recorded_first_id,
      groups: grpCntRow.cnt,
    };
  },

  async xinfoGroups(key: string): Promise<GroupInfo[]> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT 1 FROM stream_meta WHERE key = ?').get(key);
    if (!metaRow) throw new Error('ERR no such key');

    const groups = this.db
      .prepare(
        'SELECT group_name, last_delivered_id, entries_read FROM stream_groups WHERE key = ?'
      )
      .all(key) as { group_name: string; last_delivered_id: string; entries_read: number }[];
    const cntRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM stream_entries WHERE key = ?')
      .get(key) as { cnt: number };

    const result: GroupInfo[] = [];
    for (const grp of groups) {
      const consumerCnt = this.db
        .prepare(
          'SELECT COUNT(DISTINCT consumer_name) as cnt FROM stream_consumers WHERE key = ? AND group_name = ?'
        )
        .get(key, grp.group_name) as { cnt: number };
      const pendingCnt = this.db
        .prepare('SELECT COUNT(*) as cnt FROM stream_pending WHERE key = ? AND group_name = ?')
        .get(key, grp.group_name) as { cnt: number };
      result.push({
        name: grp.group_name,
        consumers: consumerCnt.cnt,
        pending: pendingCnt.cnt,
        lastDeliveredId: grp.last_delivered_id,
        entriesRead: grp.entries_read,
        lag: cntRow.cnt - grp.entries_read,
      });
    }
    return result;
  },

  async xinfoConsumers(key: string, group: string): Promise<StreamConsumer[]> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const grpRow = this.db
      .prepare('SELECT 1 FROM stream_groups WHERE key = ? AND group_name = ?')
      .get(key, group);
    if (!grpRow) throw new Error('ERR no such consumer group');

    const consumers = this.db
      .prepare(
        'SELECT consumer_name, pending_count, idle_time, last_delivered_id, last_ack_time, seen_time FROM stream_consumers WHERE key = ? AND group_name = ?'
      )
      .all(key, group) as {
      consumer_name: string;
      pending_count: number;
      idle_time: number;
      last_delivered_id: string;
      last_ack_time: number;
      seen_time: number;
    }[];

    const now = Date.now();
    return consumers.map((c) => ({
      name: c.consumer_name,
      pendingCount: c.pending_count,
      idleTime: now - c.seen_time,
      lastDeliveredId: c.last_delivered_id,
      lastAckTime: c.last_ack_time,
    }));
  },

  async xsetid(key: string, id: string): Promise<string> {
    this.evictExpired(key);
    this._ensureStreamTypeOrThrow(key);

    const metaRow = this.db.prepare('SELECT 1 FROM stream_meta WHERE key = ?').get(key);
    if (!metaRow) throw new Error('ERR no such key');

    this.db.prepare('UPDATE stream_meta SET last_id = ? WHERE key = ?').run(id, key);
    return 'OK';
  },
};
