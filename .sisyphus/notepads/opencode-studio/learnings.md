# Learnings — Phase 1: Repo Rename & Setup

## Completed: Rename opencode-remotes → opencode-studio

### What was done
- Local repo: `mv ~/Code/opencode-remotes ~/Code/opencode-studio`
- GitHub repo: `gh repo rename opencode-studio --repo breixopd/opencode-remotes`
- package.json: updated `name`, `description`, `keywords`
- Added `chokidar@^5.0.0` as runtime dependency
- Remote URL updated to `https://github.com/breixopd/opencode-studio.git`
- Build verified: `bun run build` → exit 0, `tsc --noEmit` → exit 0
- Committed and pushed to `origin/main`

### Key findings
1. **chokidar v5 is ESM-only with built-in types** — `@types/chokidar` is for v2 and is incompatible. chokidar v5 ships `index.d.ts` in its package.
2. **package.json `main` already had `./` prefix** — the scaffold was generated correctly.
3. **GitHub rename via `gh repo rename` works silently** (exit 0 on success).
4. **Remote URL must be updated manually** after `gh repo rename` — the local remote still pointed to the old URL.
5. **bun.lock is a binary-ish file** — committed as-is, 102 lines for simple dep tree.

## Phase 1 — T6: File Transfer Module (transfers.ts)

### What was done
- Created `src/sync/transfers.ts` with 3 functions:
  - `bulkSync(session, localPath, remotePath, excludes)` — tar pipe over SSH (`tar cf - --exclude=X -C localPath . | ssh remote "tar xf - -C remotePath"`)
  - `syncFile(session, localPath, remotePath)` — single file upload via SSH stream with atomic write (`.tmp` + `mv`)
  - `deleteRemoteFile(session, remotePath)` — `rm -f` on remote
- Created `src/sync/transfers.test.ts` with 13 tests covering success, failure, and arg verification
- Updated `src/sync/index.ts` to export the 3 new functions

### Key findings
1. **`mock.module` works for intercepting `spawn` in bun tests** — but `mockFn.mockReset()` in bun clears the mock IMPLEMENTATION (makes it return undefined), not just call history. **Must use `mockClear()`** to keep implementation while resetting call counts. This differs from how `mockReset` worked historically.
2. **Queue-based mock for sequential spawn calls** — For `bulkSync` which calls `spawn` 3 times (mkdir, tar, ssh), using a `procQueue` array with `shift()` in the mock function works well. Each test pre-fills the queue with the exact fake processes needed.
3. **setImmediate for async callback timing** — When the mkdir `close` handler fires synchronously and calls more spawns inside, `await new Promise(r => setImmediate(r))` reliably yields control so assertions on the second/third spawn calls work.
4. **`pipe` must be mocked on fake stdout** — `tar.stdout.pipe(ssh.stdin!)` needs `proc.stdout.pipe` to be a mock function. Use `mock(() => proc.stdout)` so it returns the destination for chaining.
5. **All streaming, no buffering** — tar pipe (`tar.stdout.pipe(ssh.stdin!)`), file stream (`stream.pipe(ssh.stdin!)`) — no data buffered in memory.

---

# Learnings — T4: SSH Session Manager

## Created
- `src/ssh/types.ts` — SSHSessionConfig, SSHSession interfaces
- `src/ssh/manager.ts` — createSession, execCommand, uploadFile, closeSession
- `src/ssh/index.ts` — re-exports
- `src/ssh/manager.test.ts` — 9 tests, all passing

### Key findings
1. **`mock.module()` must precede imports but works cross-file** in Bun. The mock intercepts `child_process` imports even from other modules (manager.ts), but the call must happen before the first import resolves.
2. **`mockFn.mockReset()` removes the implementation** in Bun, returning `undefined` for all subsequent calls. Use `mockFn.mockClear()` instead to preserve implementation while resetting call history.
3. **Shared-process mock pattern**: When testing functions that call `spawn` internally (execCommand, uploadFile), use a single shared mock process (`EventEmitter`) so all spawn invocations return the same object. This avoids complex process lifecycle tracking.
4. **SSH ControlMaster** args: `-o ControlMaster=auto`, `-o ControlPath=<path>`, `-o ControlPersist=60` for connection multiplexing. The `-N` flag keeps the master connection alive without running a remote command.
5. **`proc.stderr?.on()` uses optional chaining** — safe but the test mock must set `proc.stderr` to an EventEmitter for reliable testing.
6. **closeSession uses SIGTERM → SIGKILL escalation** with a 2-second grace period to avoid zombie processes.

## T3: Config System — Learnings

### Patterns & Conventions
- `~/.config/opencode-studio/config.json` — standard XDG config dir, no credentials stored
- Deep-merge on load: new fields added to config shape are filled from defaults without breaking existing user config
- `listProjects()` returns a shallow copy to prevent mutation of internal state
- All project mutations (add/remove) persist to disk immediately via `saveConfig()`

### Dependencies
- **zod v4.4.3** — `import { z } from "zod"` works (standard ESM)
- No other deps beyond `zod`, `os`, `path`, `fs` (all built-in)

### Testing Approach
- Used `mock.module("os", ...)` from bun:test to redirect `homedir()` to temp dir
- Dynamic `await import("./config")` in `beforeAll` — required because mock.module must be called BEFORE the config module's static initializers run (which call `homedir()`)
- Schema tests are independent of mock — imported statically at top of test file and don't call homedir

### Verification
- `bun test src/config/` → 24 pass, 0 fail, 40 expects
- `tsc --noEmit` → 0 errors
- `bun run build` → dist/index.js (175 bytes — config not yet imported in main entry)

### Files Created
- `src/config/types.ts` — StudioConfig, ProjectMapping, SSHConfig, TunnelConfig
- `src/config/defaults.ts` — DEFAULT_EXCLUDES, DEFAULT_CONFIG
- `src/config/schema.ts` — Zod schemas, validateConfig(), safeValidateConfig()
- `src/config/config.ts` — loadConfig(), saveConfig(), addProject(), removeProject(), listProjects(), getConfigPath(), getConfigDir()
- `src/config/index.ts` — barrel re-exports
- `src/config/config.test.ts` — 24 tests covering config CRUD + validation

---

# T8: SSH Tunnel Manager (tunnel/manager.ts)

## Created
- `src/tunnel/manager.ts` — `startTunnel()`, `stopTunnel()`, `isTunnelAlive()`, `isPortAvailable()`, `findAvailablePort()`, `getTunnelState()`
- `src/tunnel/index.ts` — barrel re-exports
- `src/tunnel/manager.test.ts` — 23 tests, all passing

## Key Design Decisions
1. **Singleton pattern** — one SSH tunnel per process. Module-scoped `tunnelState` prevents multiple concurrent tunnels.
2. **`-o ControlPath`** (not `ControlMaster=auto`) — tunnel only needs port forwarding, not multiplexing. The ControlPath is used for socket identity but no ControlMaster session is created.
3. **`ExitOnForwardFailure=yes`** — tunnel dies immediately if port forward fails (rather than hanging with a dead forward).
4. **`ServerAliveInterval=30` + `ServerAliveCountMax=3`** — 90-second dead-peer detection before SSH itself gives up.
5. **`StrictHostKeyChecking=accept-new`** not `no` — still rejects changed host keys.
6. **`-L port:localhost:remotePort`** — binds to localhost only (not 0.0.0.0).
7. **Auto-reconnect** — `proc.on("close")` triggers `setTimeout(10s)` then recursive `startTunnel()` call with same config.
8. **Heartbeat** — `setInterval(15s)` checks `isPortAvailable(localPort)`. If port becomes free, tunnel is marked dead.
9. **Two-phase kill** — `SIGTERM` → 5s → `SIGKILL` to prevent zombie processes.

## Edge Cases Handled
- Port conflict: `findAvailablePort()` probes ports sequentially (8444→8445→8446→...) with configurable maxAttempts
- Already-running guard: throws if `startTunnel` called while tunnel is alive
- Process-already-dead: try/catch around `kill("SIGTERM")` and `kill("SIGKILL")`
- Port freed during heartbeat: heartbeat detects port availability and marks tunnel as dead

## Testing Patterns
- **Mock `child_process.spawn`** — same EventEmitter-based fake process pattern used in ssh/manager.test.ts
- **Mock `net.createServer`** — server's `listen()` defers to a `portStatus: Map<number, boolean>` map. `false` = occupied, emits `error("EADDRINUSE")`. This enables testing port conflict fallback without real port binding.
- **`_resetTunnelState()`** — exposed for test cleanup only. Clears singleton state and heartbeat timer between tests.
- **`mockClear()` not `mockReset()`** — preserves mock implementation while resetting call counts (same learned pattern from T4/T6).

---

# T2+T3: Studio Setup Tool & Config Auto-Detection

## What was done
- **`src/config/defaults.ts`** — Removed hardcoded `skynet-vps` defaults. Replaced with empty-string generic defaults.
- **`src/config/config.ts`** — Added SSH auto-detection to `loadConfig()`. When no config file exists, calls `parseSSHConfig()` and uses the first detected host. Falls back to empty defaults if no SSH hosts found.
- **`src/tools/setup.ts`** — New `studio_setup` MCP tool. Reports configured state, auto-detects from SSH config, or reports no hosts found. Supports `force: true` to re-detect.
- **`src/index.ts`** + **`src/tools/index.ts`** — Registered `studio_setup`.
- **`src/tools/setup.test.ts`** — 6 tests covering: auto-detection from SSH hosts, already-configured guard, force re-detect, no hosts found, alias-as-host fallback, saved config structure.

## Key findings
1. **`mock.module` can mock multiple modules independently** — The setup test mocks both `../config/config` (loadConfig, saveConfig) and `../config/ssh-config` (parseSSHConfig) simultaneously. Each mock module is isolated and works correctly.
2. **Shared mutable state for mock returns** — Using module-scoped variables (`mockHosts` array, `savedConfig`) that are reset in `beforeEach` allows dynamic mock return values per test case.
3. **JSON.parse for tool return values** — The `studio_setup` tool returns `JSON.stringify()` outputs. Tests must parse them back to assert on `status`, `config`, etc.
4. **No config modifications without force** — The `existing.ssh.host` guard prevents accidental overwrites. Verified via `mockSaveConfig.not.toHaveBeenCalled()`.
5. **Existing config tests still pass** — The config tests mock `homedir()` to a temp dir, so `parseSSHConfig()` naturally returns `[]` (no SSH config in fake homedir). Auto-detection falls through to empty defaults, matching existing test expectations.

## Verification
- `bun test src/tools/setup.test.ts` → 6 pass, 0 fail
- `bun test src/config/config.test.ts` → 24 pass, 0 fail
- `bun test` (all 9 files) → 110 pass, 0 fail
- `bunx tsc --noEmit` → 0 errors

---

# T7+T8: SFTP Transfers + Archiver Module

## What was done
- **`src/sync/transfers.ts`** — Rewritten from `child_process.spawn` (tar pipe over SSH) to ssh2 SFTP:
  - `bulkSync`: Walks local directory, uploads each file via `sftp.fastPut` with atomic `.tmp` → `mv` rename
  - `syncFile`: Single file upload via `sftp.fastPut` with atomic rename
  - `deleteRemoteFile`: `execCommand(session, "rm -f ...")`
- **`src/sync/archiver.ts`** (NEW) — tar-stream cross-platform archiver:
  - `createTarStream(files)`: Packs files into a tar stream (for Windows without system tar)
  - `createTarExtractor(destDir)`: Extracts tar stream to directory
  - `isWindowsPlatform()`: Detects Windows
- **`src/types/tar-stream.d.ts`** (NEW) — Ambient type declarations for tar-stream
- **`src/sync/transfers.test.ts`** — Rewritten with mock client/sftp pattern (13 tests)
- **`src/sync/archiver.test.ts`** (NEW) — 9 tests covering pack/extract roundtrip, nested paths, empty files, Windows detection
- **`src/sync/index.ts`** — Added archiver exports

## Key findings
1. **`mock.module` contaminates other test files** when the mocked module is also imported by other test files. Used `mock.module("../ssh/manager", ...)` and it affected `ssh/manager.test.ts`. **Fix**: Avoid `mock.module` altogether. Instead, create mock client objects with mock `exec` and `sftp` methods that the real `execCommand` function (from `../ssh/manager`) will call through `session.client.exec()`.
2. **tar-stream v3 uses `streamx` not Node streams** — `Pack` extends `streamx/Readable`, not `stream.Readable`. Node's `stream/promises.pipeline()` doesn't work with streamx streams. Must use `source.pipe(dest)` with manual Promise wrapper listening for `finish`/`error` events.
3. **SFTP atomic write pattern**: `sftp.fastPut(local, remote.tmp)` → `execCommand(session, "mv remote.tmp remote")`. This avoids partial file reads on the remote side.
4. **Sequential file upload in bulkSync** — simpler than concurrent uploads with complex error tracking. Each file gets its own `mkdir -p`, `fastPut`, `mv` sequence. If any fails, the counter increments and a final aggregate error is thrown.
5. **No `child_process.spawn`** anywhere in the sync module. Confirmed via grep.
6. `walkDirectory` uses `readdirSync` with `{ withFileTypes: true }` for efficient directory enumeration without separate `stat()` calls.

## Verification
- `bun test src/sync/` → 22 pass, 0 fail (13 transfers + 9 archiver)
- `bun test` → 122 pass, 0 fail across 10 files
