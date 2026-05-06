## T9+T10: DI Cleanup — skipIf Removal

### Removed skip guards
- `src/config/config.test.ts`: 5x `describe.skipIf(!!process.env.CI)` → `describe`
  - These tests use `mock.module("os")` (bun built-in mocking, not child_process)
  - No SSH dependency — just filesystem operations
  - Work perfectly in CI
- `src/sync/watcher.test.ts`: 1x `describe.skipIf(!!process.env.CI)` → `describe`
  - Uses chokidar with real filesystem watchers
  - Works in CI environment (inotify support available)

### mock.module("child_process")
- Zero occurrences found — already cleaned up in prior work (T5-T8)

### Results
- `CI=true bun test`: 122 pass, 0 fail, 0 skip ✅
- `bun test`: 122 pass, 0 fail, 0 skip ✅
- `bunx tsc --noEmit`: 1 pre-existing error in `src/sync/transfers.ts:66` (callback param typing in sftp.fastPut — NOT related to DI cleanup)

### Pattern
- All SSH operations now use `ssh2.Client` via factory pattern (`setSSHFactory`/`resetSSHFactory`)
- No test file references `mock.module("child_process")` or `skipIf(!!process.env.CI)`
