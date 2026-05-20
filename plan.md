# Redbis Phase 1 — Implementation Plan

## Goal

Implement a TypeScript TCP server on port 6379 with structured logging, multi-client handling, graceful shutdown, and an extensible project structure for future RESP parsing and storage adapter phases.

---

## Worker Briefing

### Key Decisions

1. **TypeScript strict mode** — `tsconfig.json` MUST set `"strict": true`. No `any` types. All function parameters and returns must be typed.
2. **Node.js native `net` module only** — No Express, Koa, or any TCP framework. Use `import * as net from 'net'`. This is a hard constraint from the project owner.
3. **Minimal dependencies** — Only dev dependencies allowed: `typescript`, `@types/node`, `ts-node` (for dev), and `concurrently` or `nodemon` for watch mode. No runtime dependencies beyond Node builtins.
4. **Storage abstraction via `IStorage` interface** — Define `IStorage` in `src/storage/interface.ts` with methods for future get/set/delete/keys operations. This must exist as a contract even though Phase 1 has no implementation. SQLite adapter stub (`src/storage/sqlite.ts`) exports a class that `implements IStorage` but throws "not implemented" on every method.
5. **Structured logger** — `src/logger/index.ts` must export a Logger class/module that outputs structured JSON-like entries with level, timestamp, context/module name, and message. Not raw `console.log` calls scattered everywhere. The logger should have methods: `info()`, `warn()`, `error()`, `debug()`. Each log line must include: ISO timestamp, level, module/context tag, message, and optional data object.
6. **Connection handler separation** — Each client connection gets its own handler (`src/server/connection.ts`). The server (`src/server/index.ts`) creates the `net.Server` and delegates new sockets to the connection handler. This separation is critical for testability and future phases.
7. **Configuration via `src/config/index.ts`** — Port, host, and log level must be configurable. Use environment variables (`REDBIS_PORT`, `REDBIS_HOST`, `REDBIS_LOG_LEVEL`) with sensible defaults (port 6379, host '127.0.0.1', log level 'info'). Config is a typed object, not loose variables.
8. **Korean comments and README** — This is a Korean-origin open-source project. Code comments should be in Korean. README.md must be written in Korean with project overview. Variable/function names stay in English.
9. **`npm start` must work** — After `npm install && npm run build`, running `npm start` must launch the TCP server. The start script runs the compiled JS from `dist/`.
10. **Graceful shutdown** — The server MUST handle `SIGINT` and `SIGTERM`. On signal: stop accepting new connections, close existing connections, then exit cleanly. No process.exit without cleanup.

### Pitfalls & What to Avoid

1. **Do NOT crash on client disconnect** — When a client disconnects abruptly (e.g., kills the connection), the server must log it and continue serving other clients. Attach `'error'` and `'close'` event handlers to every socket. Unhandled `'error'` on a socket will crash the process.
2. **Do NOT use `console.log` directly** — All logging goes through the structured Logger. No `console.log`, `console.warn`, etc. outside the logger module itself.
3. **Do NOT implement RESP parsing** — Phase 1 only logs raw incoming data. Do not attempt to parse RESP commands. The `src/protocol/parser.ts` is a stub with a TODO comment.
4. **Do NOT implement database operations** — Storage stubs throw "not implemented" errors. No SQLite, no file I/O for data storage.
5. **Do NOT forget to `git checkout -b feat/tcp-server-and-logger`** — The git repo has no commits yet. The worker must create the initial commit on branch `feat/tcp-server-and-logger`.
6. **Do NOT hardcode port/host** — Always read from config which reads from environment variables.
7. **Do NOT ignore TypeScript compilation errors** — The project must compile cleanly with `tsc` under strict mode. Run `npm run build` and verify zero errors before declaring done.

### Constraints

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js (use `net` module — no C++ addons, no native modules)
- **No runtime dependencies**: Only dev dependencies in package.json
- **Entry point**: `src/index.ts` → compiles to `dist/index.js`
- **Port**: default 6379, configurable via `REDBIS_PORT` env var
- **Host**: default 127.0.0.1, configurable via `REDBIS_HOST` env var
- **Output directory**: `dist/` (compile target in tsconfig.json)
- **Node.js target**: ES2020 or later (for async generators, optional chaining, etc.)
- **Module system**: CommonJS for compatibility (`"module": "commonjs"` in tsconfig)

### Scope Boundary

**IN scope:**
- package.json with scripts (build, start, dev)
- tsconfig.json with strict mode
- .gitignore for Node.js/TypeScript
- README.md in Korean with project overview
- TCP server listening on configurable port
- Structured logger module
- Connection handler per client socket
- Multi-client async handling
- Graceful shutdown on SIGINT/SIGTERM
- Config module (env vars with defaults)
- IStorage interface definition
- SQLite adapter stub (implements IStorage, throws "not implemented")
- RESP parser stub (empty or TODO)
- Initial git commit on branch `feat/tcp-server-and-logger`
- Logging incoming raw data from redis-cli connections

**OUT of scope:**
- RESP protocol parsing (Phase 2)
- Actual database read/write (Phase 2)
- Redis command handling (Phase 2+)
- Authentication (future)
- Docker/deployment configs
- Performance benchmarking
- Unit tests (can be Phase 1.5 or Phase 2 — not required now)
- Any npm runtime dependencies

---

## Tasks

### Task 1: Create package.json
- **File**: `/root/redbis/package.json`
- **Action**: Create with name "redbis", version "0.1.0", description in Korean, scripts: `build` (tsc), `start` (node dist/index.js), `dev` (ts-node src/index.ts or nodemon equivalent). Dev dependencies: typescript, @types/node. Main: "dist/index.js". Types: "dist/index.d.ts" (optional for Phase 1).
- **Acceptance**: `npm install` succeeds. `npm run build` calls tsc.

### Task 2: Create tsconfig.json
- **File**: `/root/redbis/tsconfig.json`
- **Action**: strict: true, target: ES2020, module: commonjs, outDir: ./dist, rootDir: ./src, include: [src], exclude: [node_modules, dist]. sourceMap: true, declaration: true.
- **Acceptance**: `npx tsc --noEmit` passes. `npm run build` produces dist/ output.

### Task 3: Create .gitignore
- **File**: `/root/redbis/.gitignore`
- **Action**: Add node_modules/, dist/, *.js.map, .env, .DS_Store, coverage/.
- **Acceptance**: `git status` does not show node_modules or dist.

### Task 4: Create src/config/index.ts
- **File**: `/root/redbis/src/config/index.ts`
- **Action**: Export a typed `Config` interface and a `loadConfig()` function. Read REDBIS_PORT (default 6379), REDBIS_HOST (default '127.0.0.1'), REDBIS_LOG_LEVEL (default 'info'). Validate port is a number. Export singleton config object.
- **Acceptance**: Config values are typed. Env vars override defaults. Can import and use in server.

### Task 5: Create src/logger/index.ts
- **File**: `/root/redbis/src/logger/index.ts`
- **Action**: Create `Logger` class with constructor taking module: string. Methods: info(msg, data?), warn(msg, data?), error(msg, data?), debug(msg, data?). Each method outputs a structured JSON line: `{ timestamp, level, module, message, data? }`. Respect log level from config (debug < info < warn < error). Export a factory function `createLogger(module: string): Logger`.
- **Acceptance**: Can call `createLogger('server').info('listening', { port: 6379 })` and get structured JSON output to stdout.

### Task 6: Create src/storage/interface.ts
- **File**: `/root/redbis/src/storage/interface.ts`
- **Action**: Define `IStorage` interface with methods: `get(key: string): Promise<string | null>`, `set(key: string, value: string): Promise<void>`, `delete(key: string): Promise<boolean>`, `keys(pattern: string): Promise<string[]>`, `flush(): Promise<void>`. Also define `StorageConfig` interface. Export both.
- **Acceptance**: Other modules can `import { IStorage } from './interface'`.

### Task 7: Create src/storage/sqlite.ts (stub)
- **File**: `/root/redbis/src/storage/sqlite.ts`
- **Action**: Create `SqliteStorage` class implementing `IStorage`. Each method throws `new Error('Not implemented: SqliteStorage.<method>')`. Add Korean comment explaining this will be implemented in Phase 2.
- **Acceptance**: Compiles. Methods throw on call.

### Task 8: Create src/protocol/parser.ts (stub)
- **File**: `/root/redbis/src/protocol/parser.ts`
- **Action**: Create `RespParser` class with a `feed(data: Buffer): void` method and a TODO comment that full RESP parsing is Phase 2. Also add a `parse()` placeholder that returns null. Add Korean comment.
- **Acceptance**: Compiles. Exportable but non-functional (by design).

### Task 9: Create src/server/connection.ts
- **File**: `/root/redbis/src/server/connection.ts`
- **Action**: Export `handleConnection(socket: net.Socket): void` function. Log new connection with remote address/port. Attach `'data'` handler that logs raw bytes (hex or string representation) via structured logger. Attach `'error'` handler that logs error but does NOT throw. Attach `'close'` handler that logs disconnection. Track connection count (export a getter for stats if desired). Use `createLogger('connection')`.
- **Acceptance**: Connecting with redis-cli or telnet shows structured connection/disconnection logs. Killing the client does NOT crash the server.

### Task 10: Create src/server/index.ts
- **File**: `/root/redbis/src/server/index.ts`
- **Action**: Export `createServer(config: Config): net.Server` function. Create `net.Server`, attach `'connection'` event calling `handleConnection`. Return the server. Also export `startServer(config: Config): Promise<void>` that creates, listens, and resolves when server is listening. Export `shutdownServer(server: net.Server): Promise<void>` for graceful shutdown.
- **Acceptance**: Server listens on configured port. Multiple clients can connect simultaneously.

### Task 11: Create src/index.ts (entry point)
- **File**: `/root/redbis/src/index.ts`
- **Action**: Import config, logger, server. On start: loadConfig, createServer, startServer, log "Redbis server started on host:port". On SIGINT/SIGTERM: log shutdown signal, call shutdownServer, then process.exit(0). Set a timeout force-exit after 5s if graceful shutdown hangs.
- **Acceptance**: `npm start` launches server. Ctrl+C cleanly shuts down. Server appears on port 6379.

### Task 12: Create README.md
- **File**: `/root/redbis/README.md`
- **Action**: Write in Korean. Include: 프로젝트 이름 (Redbis), 프로젝트 개요 (Redis 프로토콜 인터페이스를 제공하는 RDBMS 백엔드 미들웨어 프록시), Phase 1 기능 (TCP 서버, 구조화 로거, 다중 클라이언트, 우아한 종료), 설치/실행 방법 (npm install, npm run build, npm start), 환경변수 (REDBIS_PORT, REDBIS_HOST, REDBIS_LOG_LEVEL), 프로젝트 구조 (디렉토리 트리), 향후 계획 (Phase 2: RESP 파싱, Phase 3: SQLite 스토리지 연동).
- **Acceptance**: README contains all required sections in Korean. Project structure tree matches actual files.

### Task 13: Install dependencies and build
- **Action**: Run `npm install` then `npm run build`. Fix any TypeScript compilation errors. Verify dist/ directory contains compiled JS.
- **Acceptance**: Zero compilation errors. `dist/index.js` exists.

### Task 14: Smoke test
- **Action**: Run `npm start` in background. Connect with `redis-cli` or `telnet 127.0.0.1 6379`. Verify server logs connection and data. Verify typing `PING` logs incoming bytes. Kill client connection. Verify server does not crash. Send SIGINT to server. Verify clean exit.
- **Acceptance**: Server runs, accepts connections, logs data, handles disconnect, shuts down cleanly.

### Task 15: Git commit
- **Action**: `git checkout -b feat/tcp-server-and-logger`, `git add -A`, `git commit -m "feat: Phase 1 - TCP server, structured logger, extensible project structure"`.
- **Acceptance**: All files committed on correct branch. `git log` shows the commit.

---

## Files to Modify

(N/A — all files are new)

## New Files

| File | Purpose |
|------|---------|
| `/root/redbis/package.json` | Project manifest, scripts, dev dependencies |
| `/root/redbis/tsconfig.json` | TypeScript config (strict, ES2020, CommonJS) |
| `/root/redbis/.gitignore` | Ignore node_modules, dist, etc. |
| `/root/redbis/README.md` | Korean project overview and usage guide |
| `/root/redbis/src/index.ts` | Entry point — boot server, handle signals |
| `/root/redbis/src/config/index.ts` | Configuration loader (env vars + defaults) |
| `/root/redbis/src/logger/index.ts` | Structured JSON logger with module tagging |
| `/root/redbis/src/server/connection.ts` | Per-connection handler (data logging, error/cleanup) |
| `/root/redbis/src/server/index.ts` | TCP server creation, start, graceful shutdown |
| `/root/redbis/src/protocol/parser.ts` | RESP parser stub (Phase 2 TODO) |
| `/root/redbis/src/storage/interface.ts` | IStorage interface definition |
| `/root/redbis/src/storage/sqlite.ts` | SQLite adapter stub (throws not implemented) |

## Dependencies

```
Task 4 (config) ← Task 5 (logger needs config for log level)
Task 4, 5 ← Task 9 (connection handler uses config + logger)
Task 4, 5 ← Task 10 (server uses config + logger)
Task 6 ← Task 7 (SQLite stub implements IStorage)
Task 9, 10 ← Task 11 (entry point orchestrates server)
Tasks 1-11 ← Task 12 (README references all created files)
Task 1, 2 ← Task 13 (need package.json + tsconfig before npm install/build)
Task 13 ← Task 14 (smoke test requires built project)
Task 14 ← Task 15 (commit after verified working)
```

**Recommended execution order**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15

## Risks

1. **redis-cli sends RESP-formatted data** — redis-cli connects but sends RESP protocol data (e.g., `*1\r\n$4\r\nPING\r\n`). The connection handler should log this raw data cleanly. Use `data.toString('utf8')` or hex dump for visibility. This is expected behavior — we're logging it, not parsing it.

2. **redis-cli may disconnect if no RESP response** — redis-cli expects a RESP reply. Since we don't send responses in Phase 1, redis-cli may timeout or show an error. This is acceptable. Document this in README. The server must NOT crash from this.

3. **TypeScript strict mode may catch unexpected errors** — Ensure all variables are typed, no implicit any, strict null checks. The `net.Socket` event handlers need proper typing.

4. **Port 6379 may already be in use** — If Redis is installed on the system, port 6379 might be occupied. The server should log a clear error and exit if the port is unavailable. Check `server.on('error')` for `EADDRINUSE`.

5. **Graceful shutdown timeout** — If connections don't close within a reasonable time (5 seconds), force exit. Implement this to avoid hanging processes.

6. **Git repo has no initial commit** — The .git directory exists but has no commits and no branch. Worker must create the branch and initial commit as the final step.