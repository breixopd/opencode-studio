# Contributing to opencode-studio

## Setup

```bash
bun install
bun run build
```

## Development

```bash
bun run dev     # Watch mode -- rebuilds on source changes
```

## Testing

```bash
bun test        # Run all tests with Bun's test runner
```

Test files sit next to their source files with `.test.ts` suffix:

- `src/tunnel/manager.test.ts` -- Tunnel lifecycle, port detection, auto-reconnect
- `src/sync/watcher.test.ts` -- File watching, batching, deduplication, exclusions
- `src/sync/transfers.test.ts` -- Bulk sync, incremental sync, remote delete
- `src/ssh/manager.test.ts` -- Session creation, command execution, file upload
- `src/config/config.test.ts` -- Config load/save, project CRUD, schema validation
- `src/tools/sync.test.ts` -- Sync tool MCP integration
- `src/tools/tunnel.test.ts` -- Tunnel tool MCP integration

## Type Checking

```bash
bunx tsc --noEmit
```

## Build

```bash
bun run build   # Outputs to dist/
```

## Project Structure

```
src/
  config/        Config system with Zod validation
    config.ts    Config file read/write, project CRUD
    schema.ts    Zod schemas for SSH, tunnel, project configs
    defaults.ts  Default config values and exclude patterns
    types.ts     TypeScript interfaces for all config types
    index.ts     Public API exports
  ssh/           SSH session manager
    manager.ts   Session creation, ControlMaster multiplexing, command exec
    types.ts     SSHSession and SSHSessionConfig types
    index.ts     Public API exports
  sync/          File sync engine
    watcher.ts   chokidar-based file watching with debounce and dedup
    transfers.ts tar bulk sync, incremental SSH stream, remote delete
    events.ts    Sync event types
    index.ts     Public API exports
  tunnel/        SSH tunnel manager
    manager.ts   Tunnel lifecycle, port detection, auto-reconnect, heartbeat
    index.ts     Public API exports
  tools/         MCP tools
    sync.ts      studio_sync_start / studio_sync_stop
    tunnel.ts    studio_tunnel_status / studio_tunnel_restart
    config.ts    studio_add_project / studio_remove_project
    status.ts    studio_status / studio_list_projects
    index.ts     Public API exports
rules/           Bundled OpenCode rules and SKILL.md files
scripts/         Utility scripts
  verify-coexistence.sh  Check coexistence with legacy tunnel on port 8443
```

## Commit Convention

Use conventional commits:

```
feat(tunnel): add port conflict detection with automatic fallback
fix(sync): handle SSH connection refused during bulk sync
docs: add README with configuration guide
chore: update dependencies
test(watcher): add test for event deduplication
ci: add GitHub Actions release workflow
```

Types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `style`, `ci`, `perf`

One commit per logical change. Keep subject lines under 72 characters.

## Pull Request Process

1. Run `bun test` and `bunx tsc --noEmit` to verify nothing is broken
2. Write a clear PR description covering what, why, and how you tested
3. Link related issues with `Closes #123` or `Related to #456`
4. Mark breaking changes with a `BREAKING CHANGE:` footer

## CI

Two GitHub Actions workflows:

- **CI** -- Triggers on push/PR to `main`. Runs `bun install`, `bun run build`, `bunx tsc --noEmit`, `bun test`.
- **Release** -- Triggers on `v*.*.*` tags. Runs CI steps then publishes to npm with `--access public`.

## License

MIT
