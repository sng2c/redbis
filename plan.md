# Redbis Phase 1 — Vitest Test Cases Addition Plan

## Goal

Add Vitest test coverage for all 7 Phase 1 modules of the Redbis project, with test descriptions in Korean, integration-style TCP tests for server/connection, and unit tests for config/logger/parser/sqlite.

---

## Worker Briefing

### Key Decisions

1. **Vitest is the test framework** — No other test runner. Install `vitest` as a devDependency and configure `vitest.config.ts`.
2. **Test descriptions in Korean** — All `describe()`, `it()`, `test()` description strings MUST be written in Korean (e.g., `'환경변수가 없을 때 기본값을 반환한다'`). Code, variable names, and import paths remain in English.
3. **Integration-style tests for server/connection** — Use Node.js `net` module to create real TCP servers and clients. Do NOT mock `net.Server` or `net.Socket`. Use random/high ports (e.g., port 0 to let OS assign, or ports like 16379) to avoid conflicts with any real services.
4. **Logger tests capture `process.stdout.write`** — Use `vi.spyOn(process.stdout, 'write')` to intercept JSON output. Parse the captured output as JSON and assert on `level`, `module`, `message`, `data` fields. Always restore the spy in `afterEach`.
5. **Config tests stub/restore env vars** — Use `vi.stubEnv()` / `vi.unstubAllEnvs()` or manual `process.env` save/restore to test different config scenarios. This is critical because `loadConfig()` reads from `process.env`.
6. **Relative assertions for `activeConnections`** — The `activeConnections` counter in `connection.ts` is a module-level variable with no reset function, and we CANNOT modify source files. Always assert relative changes (e.g., "count increased by 1 after connect") and verify cleanup (count returns to baseline in `afterEach`). Never assume the absolute starting value is 0.
7. **tsconfig.json MUST be updated** — Add `"src/__tests__"` to the `exclude` array so `tsc` does not compile test files into `dist/`. This is necessary for `npm run build` to remain clean. While the task says "only modify package.json/vitest.config.ts", the build constraint (`npm run build` must pass) makes this a mandatory change too.
8. **Use `vitest run` for `npm test`** — The `npm test` script should run `vitest run` (single execution, no watch mode). Add a `test:watch` script separately for development.
9. **Port 0 strategy for integration tests** — When creating TCP servers in tests, use port 0 to let the OS assign an available port, then read `server.address().port` to get the actual port. This avoids EADDRINUSE and port conflicts entirely.
10. **Async/await for all server operations** — Server start, connect, close are all async. Always use `await` and proper Promise handling. Never forget to close servers and sockets in `afterEach`.

### Pitfalls & What to Avoid

1. **DO NOT modify any source files in `src/`** — Only add new files. The test files are in `src/__tests__/`. The only existing files you modify are `package.json` and `tsconfig.json` (and you create `vitest.config.ts`).
2. **Module-level side effects in config** — `import { config } from '../config'` triggers `loadConfig()` once at import time. The `config` singleton cannot be changed by altering env vars after import. For testing `loadConfig()` with different env vars, either: (a) use `vi.stubEnv()` before any `loadConfig()` call, or (b) call `loadConfig()` directly (it re-reads env vars each time).
3. **Logger uses `process.stdout.write`** — Do NOT use `console.log` spies; the Logger writes to `process.stdout.write` directly. Spy on that method specifically.
4. **Logger only includes `data` field when non-empty** — The Logger implementation skips the `data` field when `data` is `undefined` or has zero keys (`Object.keys(data).length > 0`). Test both cases: with data and without data.
5. **`shutdownServer` resolves even on timeout** — `shutdownServer` returns a Promise that resolves (not rejects) even when the force-exit timer fires. Tests should verify this behavior.
6. **`isLogLevelEnabled` fallback behavior** — When given an unknown log level string, `isLogLevelEnabled` falls back to `'info'` priority (via `LOG_LEVELS[configLevel] ?? LOG_LEVELS.info`). Test this edge case.
7. **Socket timeout destroys the socket** — The 5-minute (300000ms) timeout in `handleConnection` calls `socket.destroy()`. In integration tests, do NOT test the actual 5-minute timeout (too slow). Instead, test that `socket.setTimeout` is called with `300000` by spying on the method, or use a mock socket.
8. **Test isolation for `activeConnections`** — Each test file imports the same `connection` module, so `activeConnections` is shared. Use `beforeEach`/`afterEach` to ensure connections are fully cleaned up so the count returns to the starting baseline.
9. **EADDRINUSE testing** — When testing EADDRINUSE in server tests, start a server on a specific port first, then try to start another server on the same port. Clean up both servers afterward. Use unique high ports to avoid conflicts with system services.
10. **`SqliteStorage` methods are async** — All methods return promises that reject (throw). Use `await expect(method()).rejects.toThrow(...)` pattern in tests, not `.toThrow()` on the call directly.

### Constraints

- **Language**: TypeScript
- **Test framework**: Vitest
- **Test directory**: `src/__tests__/`
- **Test file naming**: `<module>.test.ts` (e.g., `config.test.ts`, `logger.test.ts`)
- **All test descriptions in Korean**
- **Existing source files in `src/` MUST NOT be modified**
- **`npm run build` MUST still pass** after changes
- **`npm test` MUST work** after `npm install`
- **No additional runtime dependencies** — vitest is a devDependency only

### Scope Boundary

**IN scope:**
- Vitest configuration (`vitest.config.ts`)
- `package.json` update (vitest devDependency, test scripts)
- `tsconfig.json` update (exclude test directory from build)
- `src/__tests__/config.test.ts` — unit tests for config module
- `src/__tests__/logger.test.ts` — unit tests for logger module
- `src/__tests__/parser.test.ts` — unit tests for RESP parser stub
- `src/__tests__/sqlite.test.ts` — unit tests for SQLite storage stub
- `src/__tests__/server.test.ts` — integration tests for TCP server
- `src/__tests__/connection.test.ts` — integration tests for connection handler
- Running `npm install` and `npm test` to verify

**OUT of scope:**
- Modifying any existing source files in `src/`
- E2E tests
- Coverage report configuration
- CI/CD configuration
- Adding new source features

---

## Tasks

### Task 1: Install vitest and update package.json

- **File**: `/root/redbis/package.json`
- **Action**: 
  - Add `"vitest": "^2.1.0"` to `devDependencies`
  - Add `"test": "vitest run"` to `scripts`
  - Add `"test:watch": "vitest"` to `scripts`
- **Verification**: `cat package.json` shows vitest in devDependencies and both test scripts

### Task 2: Create vitest.config.ts

- **File**: `/root/redbis/vitest.config.ts`
- **Action**: Create with:
  ```typescript
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      globals: true,
      environment: 'node',
      include: ['src/__tests__/**/*.test.ts'],
      testTimeout: 10000,
    },
  });
  ```
- **Rationale**: `globals: true` allows `describe`/`it`/`expect` without imports. `environment: 'node'` is appropriate for a Node.js TCP server project. `testTimeout: 10000` gives integration tests (TCP connect/close) enough time.

### Task 3: Update tsconfig.json to exclude test directory

- **File**: `/root/redbis/tsconfig.json`
- **Action**: Change `"exclude": ["node_modules", "dist"]` to `"exclude": ["node_modules", "dist", "src/__tests__"]`
- **Rationale**: Test files import from `vitest` and should not be compiled by `tsc` into `dist/`. This ensures `npm run build` still passes cleanly.

### Task 4: Run npm install

- **Action**: Run `cd /root/redbis && npm install`
- **Verification**: `node_modules/.bin/vitest --version` prints a version number

### Task 5: Create src/__tests__/config.test.ts

- **File**: `/root/redbis/src/__tests__/config.test.ts`
- **Action**: Create with the following test cases:
  
  **describe('loadConfig')**:
  1. `it('환경변수가 없을 때 기본값을 반환한다')` — Call `loadConfig()` with no env vars set, verify `{ port: 6379, host: '127.0.0.1', logLevel: 'info' }`
  2. `it('REDBIS_PORT 환경변수로 포트를 설정할 수 있다')` — Set `REDBIS_PORT=6380`, call `loadConfig()`, verify `port: 6380`
  3. `it('REDBIS_HOST 환경변수로 호스트를 설정할 수 있다')` — Set `REDBIS_HOST=0.0.0.0`, call `loadConfig()`, verify `host: '0.0.0.0'`
  4. `it('REDBIS_LOG_LEVEL 환경변수로 로그 레벨을 설정할 수 있다')` — Set `REDBIS_LOG_LEVEL=debug`, call `loadConfig()`, verify `logLevel: 'debug'`
  5. `it('REDBIS_LOG_LEVEL이 대문자여도 소문자로 정규화된다')` — Set `REDBIS_LOG_LEVEL=DEBUG`, call `loadConfig()`, verify `logLevel: 'debug'`
  6. `it('유효하지 않은 포트 번호일 때 에러를 발생시킨다')` — Test NaN (`REDBIS_PORT=abc`), too low (`REDBIS_PORT=0`), too high (`REDBIS_PORT=70000`), negative (`REDBIS_PORT=-1`). Expect `throw new Error(...)` with Korean message containing '유효하지 않은 포트 번호'
  7. `it('유효하지 않은 로그 레벨일 때 에러를 발생시킨다')` — Set `REDBIS_LOG_LEVEL=invalid`, verify throws with Korean message containing '유효하지 않은 로그 레벨'
  8. `it('경계값 포트 번호가 허용된다')` — Test port 1 and port 65535
  
  **Implementation notes**:
  - Use `vi.stubEnv()` and `vi.unstubAllEnvs()` for env var manipulation
  - For throw tests, wrap `loadConfig()` call and assert with `expect(fn).toThrow()`
  - Reset env vars in `afterEach` via `vi.unstubAllEnvs()`

  **describe('isLogLevelEnabled')**:
  9. `it('config 레벨보다 높은 우선순위 메시지 레벨은 활성화된다')` — `isLogLevelEnabled('info', 'error')` → true
  10. `it('config 레벨과 같은 우선순위 메시지 레벨은 활성화된다')` — `isLogLevelEnabled('info', 'info')` → true
  11. `it('config 레벨보다 낮은 우선순위 메시지 레벨은 비활성화된다')` — `isLogLevelEnabled('info', 'debug')` → false
  12. `it('알 수 없는 로그 레벨은 info 우선순위로 처리된다')` — `isLogLevelEnabled('info', 'unknown')` → true (falls back to info priority)

### Task 6: Create src/__tests__/logger.test.ts

- **File**: `/root/redbis/src/__tests__/logger.test.ts`
- **Action**: Create with the following test cases:

  **Setup**: Spy on `process.stdout.write` in `beforeEach`, restore in `afterEach`. Clear call history between tests.

  **describe('Logger')**:
  1. `it('createLogger가 Logger 인스턴스를 반환한다')` — `createLogger('test')` returns instance of `Logger`
  
  **describe('Logger.log methods')**:
  2. `it('info 메서드가 올바른 JSON 형식으로 출력한다')` — Call `logger.info('테스트 메시지')`, capture output, parse as JSON, verify `level: 'info'`, `module: 'test'`, `message: '테스트 메시지'`, and `timestamp` is a valid ISO string
  3. `it('warn 메서드가 올바른 JSON 형식으로 출력한다')` — Same for `warn`
  4. `it('error 메서드가 올바른 JSON 형식으로 출력한다')` — Same for `error`
  5. `it('debug 메서드가 올바른 JSON 형식으로 출력한다')` — Same for `debug`. Note: debug may be filtered if default logLevel is 'info'. Set `REDBIS_LOG_LEVEL=debug` via `vi.stubEnv` before importing/requiring, OR mock `isLogLevelEnabled` to return true for debug.
  6. `it('data 객체가 포함될 때 data 필드가 출력된다')` — Call `logger.info('메시지', { key: 'value' })`, verify parsed JSON has `data: { key: 'value' }`
  7. `it('data가 빈 객체일 때 data 필드가 생략된다')` — Call `logger.info('메시지', {})`, verify parsed JSON does NOT have `data` key
  8. `it('data가 undefined일 때 data 필드가 생략된다')` — Call `logger.info('메시지')`, verify parsed JSON does NOT have `data` key
  9. `it('출력이 줄바꿈으로 끝난다')` — Verify captured string ends with `\n`

  **describe('로그 레벨 필터링')**:
  10. `it('현재 로그 레벨보다 낮은 우선순위 메시지는 출력되지 않는다')` — With default 'info' level, `logger.debug('숨겨짐')` should not call `process.stdout.write`

  **Implementation notes for debug level test**:
  - Since the logger module imports `config` (singleton) at module load time, and `config.logLevel` is determined before tests run, the simplest approach for the debug test is to use `vi.mock('../config', ...)` to control what `config.logLevel` and `isLogLevelEnabled` return. Alternatively, import the `Logger` class directly and test its `debug` method with a mocked config.
  - **Recommended approach**: Use `vi.mock('../config')` to mock `isLogLevelEnabled` to return `true` for all levels. Then test that `debug` outputs correctly when the level is enabled.

### Task 7: Create src/__tests__/parser.test.ts

- **File**: `/root/redbis/src/__tests__/parser.test.ts`
- **Action**: Create with the following test cases:

  **describe('RespParser')**:
  1. `it('RespParser 인스턴스를 생성할 수 있다')` — `new RespParser()` does not throw
  2. `it('feed 메서드가 예외 없이 호출된다')` — Call `parser.feed(Buffer.from('*1\r\n$4\r\nPING\r\n'))`, verify no exception
  3. `it('parse 메서드가 null을 반환한다')` — `parser.parse()` returns `null`
  4. `it('feed 호출 후에도 parse는 null을 반환한다')` — Feed some data, then verify `parse()` still returns null (stub behavior)
  5. `it('빈 버퍼로 feed를 호출해도 예외가 발생하지 않는다')` — `parser.feed(Buffer.alloc(0))` does not throw

### Task 8: Create src/__tests__/sqlite.test.ts

- **File**: `/root/redbis/src/__tests__/sqlite.test.ts`
- **Action**: Create with the following test cases:

  **describe('SqliteStorage')**:
  1. `it('SqliteStorage 인스턴스를 생성할 수 있다')` — `new SqliteStorage()` does not throw
  2. `it('get 메서드가 구현되지 않음 에러를 발생시킨다')` — `await expect(storage.get('key')).rejects.toThrow('Not implemented: SqliteStorage.get')`
  3. `it('set 메서드가 구현되지 않음 에러를 발생시킨다')` — `await expect(storage.set('key', 'value')).rejects.toThrow('Not implemented: SqliteStorage.set')`
  4. `it('delete 메서드가 구현되지 않음 에러를 발생시킨다')` — `await expect(storage.delete('key')).rejects.toThrow('Not implemented: SqliteStorage.delete')`
  5. `it('keys 메서드가 구현되지 않음 에러를 발생시킨다')` — `await expect(storage.keys('*')).rejects.toThrow('Not implemented: SqliteStorage.keys')`
  6. `it('flush 메서드가 구현되지 않음 에러를 발생시킨다')` — `await expect(storage.flush()).rejects.toThrow('Not implemented: SqliteStorage.flush')`

  **Implementation note**: All methods are async and throw. Must use `await expect(...).rejects.toThrow(...)` pattern.

### Task 9: Create src/__tests__/connection.test.ts

- **File**: `/root/redbis/src/__tests__/connection.test.ts`
- **Action**: Create with the following test cases:

  This is an integration test file. Uses real `net.Server` and `net.Socket` objects.

  **Setup** (`beforeEach`):
  - Create a TCP server via `net.createServer((socket) => handleConnection(socket))`
  - Start listening on port 0 (OS-assigned port), record the actual port
  - Record `getActiveConnectionCount()` as `baseCount`

  **Teardown** (`afterEach`):
  - Close all connected client sockets
  - Close the server
  - Wait for server close to complete
  - Verify `getActiveConnectionCount() === baseCount`

  **describe('handleConnection')**:
  1. `it('클라이언트가 연결되면 활성 연결 수가 증가한다')` — Connect a client, verify `getActiveConnectionCount() === baseCount + 1`
  2. `it('클라이언트가 연결을 종료하면 활성 연결 수가 감소한다')` — Connect then disconnect a client, verify count returns to `baseCount`
  3. `it('여러 클라이언트가 동시에 연결될 수 있다')` — Connect 3 clients, verify count is `baseCount + 3`
  4. `it('클라이언트 연결 해제 시 hadError 정보와 함께 로깅된다')` — This is hard to test directly without mocking logger. Skip or note as limitation.

  **describe('getActiveConnectionCount')**:
  5. `it('초기 활성 연결 수를 반환한다')` — Verify `baseCount` is a number ≥ 0

  **Implementation notes**:
  - Use `net.createConnection({ port: actualPort, host: '127.0.0.1' })` to create clients
  - Wrap socket events in Promises for async test flow
  - Timeout: add `testTimeout: 10000` in vitest config for this file

### Task 10: Create src/__tests__/server.test.ts

- **File**: `/root/redbis/src/__tests__/server.test.ts`
- **Action**: Create with the following test cases:

  **describe('createServer')**:
  1. `it('net.Server 인스턴스를 생성한다')` — `createServer({ port: 6379, host: '127.0.0.1', logLevel: 'info' })` returns a `net.Server` instance

  **describe('startServer')**:
  2. `it('서버가 지정된 포트에서 수신 대기한다')` — Call `startServer` with a config using port 0, verify server is listening
  3. `it('서버가 수신 대기 시작 시 Promise를 해결한다')` — Verify `startServer` returns a Promise that resolves with the server instance

  **Setup for startServer tests** (`beforeEach`):
  - None needed (each test creates its own server)

  **Teardown** (`afterEach`):
  - Close the server from each test

  **describe('EADDRINUSE')**:
  4. `it('이미 사용 중인 포트에서 EADDRINUSE 에러가 발생한다')` — Start server A on port X, then try to start server B on same port. The second `startServer` should reject with an error. Clean up both servers.

  **describe('shutdownServer')**:
  5. `it('서버를 정상적으로 종료한다')` — Start a server, then call `shutdownServer(server)`. Verify Promise resolves.
  6. `it('연결된 클라이언트가 없을 때 즉시 종료된다')` — Start server, immediately shutdown, verify resolves quickly
  7. `it('타임아웃이 지나면 강제 종료한다')` — Start a server, connect a client that never closes, call `shutdownServer(server, 500)`. Verify the Promise resolves within ~1 second even though the client hasn't disconnected. Then close the client.
  
  **Implementation notes for EADDRINUSE test**:
  - First start a server on a specific port (not 0), then attempt to start another on the same port
  - Use a random high port number (e.g., 16379) or better: start first server on port 0, get the assigned port, then try second server on that exact port
  - Clean up: close both servers regardless of test outcome (use try/finally)

  **Implementation notes for timeout test**:
  - Use a very short timeout (e.g., 500ms) to avoid slow tests
  - Use `vi.useFakeTimers()` if needed, but real timers with short timeout (500ms) are simpler and more reliable for integration tests

### Task 11: Verify npm run build passes

- **Action**: Run `cd /root/redbis && npm run build`
- **Verification**: Build completes with zero errors. No test files in `dist/` directory.
- **If build fails**: Debug TypeScript errors. Most likely cause would be vitest types not resolving — ensure `vitest` is installed and tsconfig excludes `src/__tests__`.

### Task 12: Verify npm test passes

- **Action**: Run `cd /root/redbis && npm test`
- **Verification**: All tests pass. Output shows test results for all 6 test files.
- **If tests fail**: Read error messages, fix test code (not source code), and re-run.

---

## Files to Modify

| File | Changes |
|------|---------|
| `/root/redbis/package.json` | Add `vitest` to `devDependencies` (version `^2.1.0` or latest). Add `"test": "vitest run"` and `"test:watch": "vitest"` to `scripts`. |
| `/root/redbis/tsconfig.json` | Add `"src/__tests__"` to the `exclude` array so test files are not compiled by `tsc`. |

## New Files

| File | Purpose |
|------|---------|
| `/root/redbis/vitest.config.ts` | Vitest configuration (globals, node environment, include pattern, timeout) |
| `/root/redbis/src/__tests__/config.test.ts` | Unit tests for config module: loadConfig defaults, env var overrides, port validation, log level validation, isLogLevelEnabled |
| `/root/redbis/src/__tests__/logger.test.ts` | Unit tests for logger module: createLogger factory, JSON output format, each log method, data field inclusion, log level filtering |
| `/root/redbis/src/__tests__/parser.test.ts` | Unit tests for RESP parser stub: instantiation, feed (no-op), parse returns null |
| `/root/redbis/src/__tests__/sqlite.test.ts` | Unit tests for SQLite storage stub: instantiation, all methods throw NotImplementedError |
| `/root/redbis/src/__tests__/connection.test.ts` | Integration tests for connection handler: active connection count tracking, multi-client support, disconnection handling |
| `/root/redbis/src/__tests__/server.test.ts` | Integration tests for TCP server: createServer, startServer, shutdownServer, EADDRINUSE handling |

## Dependencies

```
Task 1 (package.json) → Task 4 (npm install)
Task 1 + Task 2 (vitest.config) → Task 4 (npm install)
Task 4 (install) → Tasks 5-10 (tests can run)
Task 3 (tsconfig) → Task 11 (build verification)
Tasks 5-10 (all tests) + Task 11 (build) → Task 12 (full verification)
```

**Recommended execution order**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12

## Risks

1. **`activeConnections` module state leak across test files** — Since `connection.ts` uses a module-level `let activeConnections = 0`, and there's no reset function, the counter could accumulate if a test doesn't clean up properly. **Mitigation**: Always use relative assertions (compare before/after). Always close all connections in `afterEach`. Verify count returns to baseline.

2. **Logger singleton config at import time** — The `config` singleton is computed once when `../config` is first imported. If `config.logLevel` is 'info' (default), `logger.debug()` calls will be silently filtered. **Mitigation**: Use `vi.mock('../config')` in logger tests to control `isLogLevelEnabled` return values. Alternatively, for the debug-when-enabled test, stub `REDBIS_LOG_LEVEL=debug` before the module is imported (this is fragile — prefer mocking).

3. **EADDRINUSE test flakiness** — Trying to bind two servers to the same port may fail if the port is already in use by another process. **Mitigation**: Use port 0 for the first server, get the assigned port from `server.address()`, then try to bind the second server to that exact port. Close both servers in `afterEach`.

4. **`process.stdout.write` spy interactions with Vitest** — Vitest uses `process.stdout.write` for its own output. Spying on it could interfere with test runner output. **Mitigation**: Use `vi.spyOn(process.stdout, 'write').mockImplementation(() => true)` to intercept and silence output during the specific test, then `restore()` in `afterEach`. This prevents logger output from mixing with test output.

5. **TypeScript compilation of test files** — If `tsconfig.json` is not updated to exclude `src/__tests__`, `tsc` will try to compile test files and may fail or include them in `dist/`. **Mitigation**: Ensure Task 3 (tsconfig update) is done before Task 11 (build verification).

6. **Socket timeout test would take 5 minutes** — Never test the actual 300000ms timeout in real time. **Mitigation**: Do not test the timeout duration directly. If needed, spy on `socket.setTimeout` to verify it was called with `300000`.

7. **Race conditions in TCP integration tests** — Server close, socket close, and connection events are all asynchronous. **Mitigation**: Always `await` server close, use `Promise` wrappers for socket events, and use `testTimeout: 10000` in vitest config to avoid premature timeouts.