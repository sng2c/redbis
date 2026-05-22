# Phase 7 — Codebase Recon

## IStorage Interface Method Count: 136

| Category | Count | Notes |
|---|---|---|
| Existing (core) | 5 | get, set, delete, keys, flush |
| Multi-key | 3 | mget, mset, msetnx |
| String ops | 6 | append, strlen, getrange, setrange, incrby, incrbyfloat |
| Conditional set | 6 | setnx, setex, psetex, getset, getdel, getex |
| Key management | 8 | rename, renamenx, type, dbsize, copy, randomkey, unlink, touch |
| Expiry | 9 | expire, expireat, pexpire, pexpireat, ttl, pttl, persist, expiretime, pexpiretime |
| SCAN | 1 | scan |
| Hash base | 18 | hset…hsetex |
| Hash field expiry | 9 | hexpire…hpttl |
| List | 21 | lpush…lmpop |
| Set | 17 | sadd…sscan |
| Sorted Set | 30 | zadd…zmpop (includes bzpopmax/min, bzmpop) |
| Server/Persistence | 3 | save, info, getLastSaveTime |

## InMemoryStorage Internal Data Structures

```ts
private store:      Map<string, StoreEntry>                                    // StoreEntry = { value: string; type: string; expiresAt: number | null }
private hashStore:   Map<string, Map<string, { value: string; expiresAt: number | null }>>
private listStore:   Map<string, string[]>
private setStore:    Map<string, Set<string>>
private zsetStore:   Map<string, Map<string, number>>                          // member → score
private startTime = Date.now()
```

## SqliteStorage CREATE TABLE Statements

```sql
CREATE TABLE IF NOT EXISTS kv_store    (key TEXT PRIMARY KEY, value TEXT NOT NULL)
CREATE TABLE IF NOT EXISTS hash_store  (key TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER DEFAULT NULL, PRIMARY KEY (key, field))
CREATE TABLE IF NOT EXISTS list_store  (key TEXT NOT NULL, seq REAL NOT NULL, value TEXT NOT NULL, PRIMARY KEY (key, seq))
CREATE TABLE IF NOT EXISTS set_store   (key TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY (key, member))
CREATE TABLE IF NOT EXISTS zset_store  (key TEXT NOT NULL, member TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY (key, member))
```

## CommandHandler Constructor Signature

```ts
import { PubSubManager } from '../pubsub/manager';

constructor(storage: IStorage, pubsub: PubSubManager, connId: string, send: (msg: string) => void)
```

## PubSubManager Class Signature (line 87)

```ts
export class PubSubManager {
  private channelSubs:    Map<string, Set<string>>                           // channel → connIds
  private patternSubs:    Map<string, Set<string>>                           // pattern → connIds
  private channelToConns: Map<string, Map<string, (msg: string) => void>>    // channel → (connId → send)
  private patternToConns: Map<string, Map<string, (msg: string) => void>>    // pattern → (connId → send)
```