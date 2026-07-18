# Contributing to opencode-studio

## Setup

```bash
bun install
bun run build
```

User-facing docs: [docs/](docs/) (getting started, budget, security, tools, architecture).

## Development

```bash
bun run dev     # Watch mode — rebuilds on source changes
```

## Testing

```bash
bun test              # Run all tests (Bun test runner)
bun run test:ci       # Isolated per-file runs (matches CI)
```

CI uses `test:ci`: each `src/**/*.test.ts` file is executed separately with a 30s timeout so one hanging suite cannot starve the rest.

Test files sit next to their sources with a `.test.ts` suffix (50+ files under `src/`). Cover core (budget, cost, index, scout, workspace), tools, hooks, config, ssh, sync, and tunnel. Prefer adding tests beside the module you change rather than a separate top-level suite.

## Architecture

**One SQLite database** (`.studio/studio.db`) holds all state:

- Code intelligence: `files`, `symbols`, `chunks`, `edges`, `imports` + `fts_chunks` (FTS5)
- Workspace: `plans`, `tasks`, `rules`, `branches`, `handoffs`, `pinned_context`, `verify_state`
- Cost ledger: `cost_events` (per-message token usage + $ cost)

Connection is held for process lifetime (one per DB path). WAL mode + FTS5 via `bun:sqlite`.

**Query helpers** (`queryAll`, `queryOne`, `runQuery` in `studio-db.ts`) wrap `bun:sqlite`'s rest-param `.all(...params)` so callers can pass explicit arrays. Always use these instead of `db.query(sql).all([array])`.

Longer layer overview: [docs/architecture.md](docs/architecture.md). Tool metadata SSOT: `src/core/tool-catalog.ts`.

## Type Checking

```bash
bunx tsc --noEmit
# or
bun run typecheck
```

## Build

```bash
bun run build   # Outputs to dist/
```

## Project Structure

```
src/
  index.ts       Plugin entry — registers tools + hooks
  tui.ts         Optional OpenCode TUI suite
  config/        Config system with Zod validation
  core/          Domain logic (SQLite, index, budget, scout, routing, …)
  hooks/         OpenCode plugin hooks
  tools/         MCP tools (studio_*)
  ssh/           SSH session manager
  sync/          File sync engine
  tunnel/        SSH tunnel + watchdog
docs/            Versioned user docs
rules/           Bundled OpenCode rules and SKILL.md files
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

1. Run `bun run test:ci` and `bun run typecheck` (or `bunx tsc --noEmit`)
2. Write a clear PR description covering what, why, and how you tested
3. Link related issues with `Closes #123` or `Related to #456`
4. Mark breaking changes with a `BREAKING CHANGE:` footer

## CI

- **CI** — push/PR to `main`: `bun install`, `bun run build`, typecheck, `bun run test:ci`
- **Release** — `v*` tags: same checks, then `npm publish` (`alpha` dist-tag for prereleases)

## License

MIT
