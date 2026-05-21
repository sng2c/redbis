# Redbis Test Coverage Analysis

## Test Cases Per File

### command.test.ts — CommandHandler
- PING: no args, with arg, lowercase
- SET: basic, wrong number of args
- GET: existing key, missing key, no args, too many args
- DEL: existing key, missing key, multiple keys, no args
- KEYS: h* pattern, * pattern, no match, no args, ? wildcard
- EXISTS: existing, missing, multiple, no args
- FLUSHDB: basic flush
- COMMAND: returns command list
- Unknown command: uppercase, lowercase, empty args array

### config.test.ts
- loadConfig: defaults, port env, host env, logLevel env, logLevel case normalization, invalid port (NaN/0/high/negative), invalid log level, boundary ports (1, 65535)
- isLogLevelEnabled: higher priority, equal priority, lower priority, unknown level fallback

### connection.test.ts
- Connection count increments/decrements, multiple simultaneous connections

### implementation.test.ts (Integration)
- SqliteStorage+CommandHandler: SET/GET, DEL, KEYS, EXISTS, FLUSHDB, PING, COMMAND, unknown, case-insensitive
- RESP Parser→CommandHandler→SqliteStorage: parse+SET, sequential commands
- InMemoryStorage+CommandHandler: SET/GET, missing key, DEL

### logger.test.ts
- createLogger returns instance, info/warn/error/debug output format, data object inclusion, empty data omission, undefined data omission, newline suffix, log level filtering

### memory-storage.test.ts
- get: missing, existing; set: basic, overwrite, multiple; delete: existing, missing; keys: *, prefix, ?, no match, empty store; flush: clears all, keys empty after

### parser.test.ts
- Inline: simple, with args, multiple spaces; RESP arrays: single element, multi element, GET, DEL, empty bulk string; Incomplete data: partial array, partial bulk, streaming; Sequential: multi RESP, multi inline; Empty buffer

### resp.test.ts
- encodeSimpleString: basic, PONG, empty; encodeError: message, empty; encodeInteger: positive, zero, negative; encodeBulkString: normal, korean, empty, null; encodeArray: strings, empty, null, single element

### server.test.ts
- createServer, startServer listening, startServer promise, EADDRINUSE, shutdownServer, shutdown with no clients, shutdown with timeout+connected client

### sqlite.test.ts
- Same as memory-storage but with SqliteStorage: get, set, delete, keys patterns, flush

---

## Gaps in Test Coverage

### 1. CommandHandler (`src/command/handler.ts`)
- **SET with ≥3 args**: Only `args.length < 2` is tested; extra args like `SET key val ex 100` are silently ignored — no test verifies this behavior
- **SET/GET with empty string values**: `SET key ""` → `GET key` returning empty string
- **DEL with duplicate keys**: `DEL key1 key1` where same key appears twice
- **EXISTS with duplicate keys**: Same concern
- **PING with multiple args**: Only first arg is used; no test for `PING a b`
- **KEYS with regex-special characters in pattern**: Patterns containing `.+^${}()|[]` — only `*` and `?` tested
- **FLUSHDB on empty store**: No assertion on return value when store is already empty

### 2. Config (`src/config/index.ts`)
- **STORAGE_TYPE env var**: No test for `storageType: 'sqlite'` default path or `'sqlite'` override
- **Invalid STORAGE_TYPE**: Unvalidated cast (`as 'memory' | 'sqlite'`) — no test for bad value
- **STORAGE_PATH env var override**: `process.env.STORAGE_PATH` is never tested
- **Default sqlite path**: When `storageType='sqlite'` and no `STORAGE_PATH`, path defaults to `./data/redbis.db` — untested
- **parsePort/parseLogLevel** direct unit testing — only tested via `loadConfig`

### 3. RespParser (`src/protocol/parser.ts`)
- **Zero-element RESP array**: `*0\r\n` — what happens?
- **Null bulk string in array**: `$-1\r\n` inside an array — code maps to empty string `''` — no test
- **Non-numeric array count**: `*abc\r\n` — `isNaN(count)` returns null — no test
- **Missing `$` prefix in bulk element**: e.g., `*1\r\n+PING\r\n` — `buffer[offset] !== 0x24` returns null — no test
- **Mixed inline + RESP in one buffer**: Not tested
- **Inline command with empty tokens**: Lines with only spaces → `split(/\s+/).filter(t => t.length > 0)` returns `[]` — no test

### 4. Connection (`src/server/connection.ts`)
- **Socket timeout handling**: `socket.setTimeout(300000)` and `'timeout'` event → `socket.destroy()` — zero test coverage
- **Socket error event**: `'error'` handler logs and nothing else — no test
- **Data→Parse→Execute→Write end-to-end**: No test sends actual RESP data through a TCP socket and verifies response
- **Command execution error catch block**: `handler.execute` rejecting — no test
- **Multi-command pipeline over single TCP connection**: Send `PING\r\nSET key val\r\n` in one data event — no test

### 5. Server (`src/server/index.ts`)
- **`closeAllConnections` fallback**: `typeof server.closeAllConnections === 'function'` branch in shutdown timeout — not directly tested (only timeout-tested with regular close)
- **End-to-end client interaction**: No test that connects a client, sends RESP commands, and reads responses

### 6. Index / Main (`src/index.ts`)
- **`createStorage('sqlite')` branch**: Not tested (all integration tests use manual `new SqliteStorage(...)`)
- **`createStorage` unknown type**: Throws `Error` — zero coverage
- **`main()` function**: SIGINT/SIGTERM graceful shutdown, startup logging, server-start failure path, `isShuttingDown` double-shutdown guard — all untested

### 7. InMemoryStorage (`src/storage/memory.ts`)
- **`globToRegex` with regex-special keys**: Keys containing `.`, `+`, `[`, etc. — pattern `test.key` used with `*` — no test for escaping correctness
- **Overwrite returns undefined**: `set` always returns `void` — no test verifying idempotency under concurrent async calls

### 8. SqliteStorage (`src/storage/sqlite.ts`)
- **`globToLike` with SQL special chars**: Keys containing `%`, `_`, `\` — pattern matching may break — no test
- **File-based DB**: All tests use `:memory:` — no test for on-disk persistence or `STORAGE_PATH` env
- **Database errors**: Locked DB, invalid path — zero error path coverage

### 9. Logger (`src/logger/index.ts`)
- **Data as non-object primitive**: `logger.info('msg', 42)` or `logger.info('msg', 'string')` — data inclusion logic only tested with `{}` and `{ key: 'value' }`
- **Data as null**: `logger.info('msg', null)` — `null` passes `typeof === 'object'` but `Object.keys(null)` throws — actually guarded by `data !== null`, but coverage gap
- **Data as array**: `logger.info('msg', [1,2,3])` — `Object.keys([1,2,3]).length === 3`, so data would be included — untested

### 10. RESP Encoder (`src/protocol/resp.ts`)
- **Strings with embedded `\r\n`**: `encodeBulkString("hello\r\nworld")` — would corrupt RESP framing — no test
- **`encodeArray` with null elements**: e.g., `['a', null as any, 'b']` — `encodeBulkString(null)` produces `$-1` which may be unexpected in array context — no test
- **Unicode byte-length edge cases**: Already tested with Korean, but emojis (multi-byte sequences) — no test

### 11. Concurrency / State-Sharing Concerns
- **Shared `activeSockets` Set**: Module-level `Set<net.Socket>` — no test for race conditions when multiple connections connect/disconnect rapidly
- **Shared `InMemoryStorage` Map**: No test for concurrent modifications from multiple commands in rapid succession
- **No stress/load test**: No test sending many commands over a single connection rapidly or over many simultaneous connections