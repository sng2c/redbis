# Redbis Phase 2 — CLI Bin Entry Point & Public README

## Goal

Add a CLI entry point (`bin/redbis.js`) and update `package.json` so that `npx redbis` or `bunx redbis` starts the Redbis server immediately. Rewrite `README.md` as a polished, public-facing open source project page (Korean default, English section headers). No changes to `src/` files.

---

## Worker Briefing

### Key Decisions

1. **`bin/redbis.js` is pure JavaScript, NOT TypeScript** — It contains a shebang (`#!/usr/bin/env node`) and uses `require()` to load `../dist/index.js`. It is never compiled by `tsc`. It lives outside `src/`.
2. **`src/index.ts` is NOT modified** — The CLI entry point delegates entirely to the compiled output. `bin/redbis.js` simply requires the already-built `dist/index.js`.
3. **`package.json` `bin` field points to `./bin/redbis.js`** — This is the standard npm pattern. npm will symlink this path when the package is installed globally or run via npx.
4. **`package.json` `files` field is `["dist/"]`** — This ensures only the compiled JavaScript and declaration files are included in the npm package. The `bin/` directory is NOT in `files` because npm always includes files referenced by the `bin` field. Source files (`src/`), tests, config files, etc. are excluded from the published package.
5. **`package.json` `prepare` script runs `npm run build`** — The `prepare` lifecycle script runs automatically after `npm install` and before `npm publish`. This ensures `dist/` is built even when someone clones the repo and runs `npm install`, or during the publish process.
6. **Error handling in `bin/redbis.js` for missing `dist/`** — If `dist/index.js` doesn't exist (e.g., clone without install), the script should print a helpful error message and exit with code 1, rather than throwing a raw `Cannot find module` error.
7. **README.md is written in Korean with English section headers** — The README should be accessible to Korean developers first, but section headers use English for international discoverability (e.g., `## 소개`, `## Installation`, `## Configuration`).
8. **`description` in `package.json` updated to a concise English description** — While the project is Korean-oriented, npm search and international discoverability benefit from an English description. The README itself is Korean-primary.
9. **`author` field in `package.json` left empty for now** — Unless specified, leave as empty string. The task doesn't mandate filling it.

### Pitfalls & What to Avoid

1. **DO NOT modify any files in `src/`** — This is the hard constraint. `bin/redbis.js` lives in `bin/`, not `src/`.
2. **DO NOT add `bin/` to the `files` array** — npm automatically includes files referenced by the `bin` field. Adding `bin/` to `files` would be redundant but not harmful. The task specifies `files: ["dist/"]` only, so follow that exactly.
3. **DO NOT forget the shebang** — `bin/redbis.js` MUST start with `#!/usr/bin/env node` on the very first line, with no preceding blank lines or BOM. Without this, `npx redbis` will fail with an exec format error on Unix-like systems.
4. **DO NOT use `import` in `bin/redbis.js`** — The tsconfig uses `"module": "commonjs"`, so `dist/index.js` uses `module.exports` / `require`. The bin file must use `require()`, not ES module `import`.
5. **DO NOT set `"type": "module"` in `package.json`** — The project uses CommonJS. Adding `"type": "module"` would break `require()` in both `dist/` output and `bin/redbis.js`.
6. **Avoid overly long README** — The README should be comprehensive but not a book. Cover: intro, features, install, quick start, config, project structure, contributing, roadmap, license. Keep each section concise.
7. **`prepare` vs `postinstall`** — Use `prepare`, NOT `postinstall`. The `prepare` script runs both on `npm install` and `npm publish`, while `postinstall` does NOT run during publish. Since we need `dist/` to exist at publish time, `prepare` is correct.
8. **Path in `require()` must be relative** — Use `require('../dist/index.js')` from `bin/redbis.js`, not an absolute path.

### Constraints

- **TypeScript strict mode**: Maintained (no tsconfig changes)
- **No `src/` modifications**: All source files remain untouched
- **`bin/redbis.js` is plain JavaScript**: No TypeScript compilation needed
- **MIT license**: Preserved
- **Package name**: `redbis` — unchanged
- **Korean README with English headers**: Follow this style consistently
- **`files` field**: Exactly `["dist/"]`
- **`prepare` script**: `"npm run build"`
- **`bin` field**: `{ "redbis": "./bin/redbis.js" }`

### Scope Boundary

**IN scope:**
- `/root/redbis/package.json` — Add `bin`, `files`, `prepare`, update `description` and `keywords`
- `/root/redbis/bin/redbis.js` — New CLI entry point (shebang + require)
- `/root/redbis/README.md` — Complete rewrite for public open source project

**OUT of scope:**
- Any file in `src/`
- `tsconfig.json`
- `vitest.config.ts`
- Test files
- `.gitignore`
- Any new features or behavior changes

---

## Tasks

### Task 1: Update package.json

**File**: `/root/redbis/package.json`

**Changes**:
1. Add `"bin"` field: `{ "redbis": "./bin/redbis.js" }`
2. Add `"files"` field: `["dist/"]`
3. Add `"prepare"` script: `"npm run build"`
4. Update `"description"` to: `"RDBMS backend middleware proxy that provides a Redis protocol (RESP) interface"`
5. Enrich `"keywords"` array: `["redis", "resp", "proxy", "middleware", "tcp-server", "rdbms", "sqlite", "database", "protocol"]`

**Final package.json should look like**:
```json
{
  "name": "redbis",
  "version": "0.1.0",
  "description": "RDBMS backend middleware proxy that provides a Redis protocol (RESP) interface",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "redbis": "./bin/redbis.js"
  },
  "files": [
    "dist/"
  ],
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepare": "npm run build"
  },
  "keywords": [
    "redis",
    "resp",
    "proxy",
    "middleware",
    "tcp-server",
    "rdbms",
    "sqlite",
    "database",
    "protocol"
  ],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.10.0",
    "ts-node": "^10.9.0",
    "vitest": "^2.1.0"
  }
}
```

**Verification**: `cat /root/redbis/package.json` — confirm all new fields present, existing fields unchanged.

---

### Task 2: Create bin/redbis.js

**File**: `/root/redbis/bin/redbis.js`

**Content**:
```javascript
#!/usr/bin/env node

'use strict';

try {
  require('../dist/index.js');
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND') {
    console.error(
      'Error: Redbis is not built. Please run "npm run build" first.\n' +
      'If you installed via npm, this should have been done automatically via the "prepare" script.'
    );
    process.exit(1);
  }
  throw err;
}
```

**Rationale**:
- `#!/usr/bin/env node` — Required shebang for Unix execution
- `'use strict'` — Best practice for Node.js scripts
- `try/catch` for `MODULE_NOT_FOUND` — Graceful error when `dist/` hasn't been built yet. This covers the case where someone clones the repo, doesn't run `npm install` (which triggers `prepare` → `npm run build`), and tries `node bin/redbis.js` directly.
- Re-throw non-MODULE_NOT_FOUND errors — Don't swallow unexpected errors

**Verification**:
1. `head -1 /root/redbis/bin/redbis.js` — must show `#!/usr/bin/env node`
2. `node -c /root/redbis/bin/redbis.js` — syntax check must pass
3. `chmod +x /root/redbis/bin/redbis.js` — make executable (important for npx)

---

### Task 3: Rewrite README.md

**File**: `/root/redbis/README.md`

**Requirements**:
- Korean body text with English section headers (e.g., `## Introduction`, `## 설치 및 실행`)
- Actually, looking at the constraint again: "Korean default, English section headers" — use English for `##` headers, Korean for content under them. This improves GitHub/SEO discoverability while keeping content accessible to Korean developers.
- Should include: project logo/banner placeholder, badges, introduction, features, installation, quick start, configuration, project structure, contributing guide, roadmap, license
- Must show `npx redbis` and `bunx redbis` as primary usage methods
- Must document environment variables (`REDBIS_PORT`, `REDBIS_HOST`, `REDBIS_LOG_LEVEL`)
- Must note that Phase 1 is TCP server + logger (RESP parsing coming in Phase 2+)
- Must include MIT license section
- Must link to future phases (RESP parsing, SQLite storage, etc.)

**Structure outline**:
```
# Redbis

> Badges (MIT, npm version placeholder)

## Introduction
Korean description of what Redbis is

## Features
- Bullet list of Phase 1 features

## Installation
npm install, npx, bunx methods

## Quick Start
How to run immediately with npx/bunx

## Configuration
Environment variables table

## Project Structure
Directory tree (consistent with current project structure)

## Development
Clone, install, build, test instructions for contributors

## Roadmap
Phase 2-4 plans

## Contributing
Brief contributing guide

## License
MIT
```

**Verification**: `wc -l /root/redbis/README.md` — should be a reasonable length (50-150 lines).

---

### Task 4: Make bin/redbis.js executable

**Command**: `chmod +x /root/redbis/bin/redbis.js`

**Rationale**: npm stores the file permission, and `npx` on Unix systems needs the executable bit set. While npm typically handles this during packaging, it's best practice to set it in the git repo as well.

---

### Task 5: Verify build still passes

**Command**: `cd /root/redbis && npm run build`

**Expected**: Clean compilation with no errors. `dist/index.js` exists.

**If fails**: The only change that could affect build is `package.json`. The `prepare` script and `bin`/`files` fields don't affect TypeScript compilation. If it fails, check that `src/` was not accidentally modified.

---

### Task 6: Verify tests still pass

**Command**: `cd /root/redbis && npm test`

**Expected**: All 44 tests pass (from Phase 1).

**If fails**: Investigate whether the `prepare` script running `npm run build` before tests could cause issues. It shouldn't — `prepare` only runs on `npm install`, not `npm test`.

---

### Task 7: Verify CLI entry point works

**Commands**:
1. `cd /root/redbis && npm run build` (ensure dist/ exists)
2. `timeout 3 node bin/redbis.js || true` — Should start the server and output logs about listening on port 6379. `timeout 3` kills it after 3 seconds (which is expected — the server runs until SIGINT).
3. Verify that the expected log line appears (something about loading config or starting server).

**Alternative if `timeout` not available**: Use `node -e "setTimeout(() => process.kill(process.pid, 'SIGINT'), 2000)" & node bin/redbis.js`

---

### Task 8: Verify error path for missing dist/

**Command**: 
```bash
mv dist dist_backup && node bin/redbis.js 2>&1; echo "Exit code: $?"
mv dist_backup dist
```

**Expected**: Should print the friendly error message about running `npm run build`, then exit with code 1.

---

## Files to Modify

| File | Changes |
|------|---------|
| `/root/redbis/package.json` | Add `bin`, `files`, `prepare` script; update `description` and `keywords` |

## New Files

| File | Purpose |
|------|---------|
| `/root/redbis/bin/redbis.js` | CLI entry point with shebang, requires `dist/index.js`, handles missing build gracefully |
| `/root/redbis/README.md` | Complete rewrite — public open source README (Korean content, English headers) |

## Dependencies

```
Task 1 (package.json) ─────┬──→ Task 5 (build verification) ──→ Task 6 (test verification)
Task 2 (bin/redbis.js) ─────┤──→ Task 7 (CLI execution test)
Task 3 (README.md) ─────────┤
Task 4 (chmod) ─────────────┘──→ Task 7 (CLI execution test)
```

**Recommended execution order**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

## Risks

1. **`prepare` script runs on `npm install` in CI/CD** — If `tsc` is not installed (e.g., `npm install --production`), the `prepare` script will fail. **Mitigation**: This is standard npm behavior and expected. Developers who clone the repo must have `devDependencies` installed for the build to work. For end users who `npm install redbis` from npm registry, `prepare` also runs, but `dist/` is already included in the package via `files`, so the build is redundant but harmless. If this becomes an issue, consider adding a conditional build check in the future (e.g., `"prepare": "node -e \"if(!require('fs').existsSync('dist'))process.exit(require('child_process').spawnSync('npm',['run','build'],{stdio:'inherit'}).status)\""`).

2. **Windows compatibility of shebang** — `#!/usr/bin/env node` is Unix-specific. On Windows, npm handles this by reading the `bin` field in `package.json` and creating a `.cmd` wrapper. This is standard npm behavior and works correctly. No action needed.

3. **`require('../dist/index.js')` path resolution** — When `bin/redbis.js` is symlinked by npm into `node_modules/.bin/redbis`, the relative path `../dist/index.js` would resolve relative to the symlink location, which would be wrong. **However**, npm handles this by creating wrapper scripts (`.cmd` on Windows, shell script on Unix) that call `node` with the correct absolute path to the actual file. The relative path in `bin/redbis.js` resolves correctly because it's relative to the real file location, not the symlink. **Important**: When installed as a dependency from npm, the package is extracted to `node_modules/redbis/`, so `bin/redbis.js` is at `node_modules/redbis/bin/redbis.js` and `dist/` is at `node_modules/redbis/dist/`. The relative path `../dist/index.js` resolves correctly in this case.

4. **README length and maintenance** — A long README may become outdated as the project evolves. **Mitigation**: Keep sections concise and factually accurate to current Phase 1 state. Mark roadmap items clearly as future plans.

5. **Circular dependency with `prepare` on publish** — When running `npm publish`, npm runs `prepare` which runs `npm run build` which runs `tsc`. This is correct and desired — it ensures `dist/` is freshly built before publishing. No issue here.

6. **`files` field only includes `dist/`** — This means `bin/redbis.js` and `README.md` are NOT in `files`. However, npm always includes: `package.json`, `README.md` (if exists), `LICENSE` (if exists), and files referenced by the `bin` field. So `bin/redbis.js` is automatically included because it's listed in `bin`. This is the correct and expected behavior. No action needed.
