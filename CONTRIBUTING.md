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

- `src/core/cost.test.ts` — Cost ledger: capture, idempotency, filtering, pruning
- `src/core/code-store.test.ts` — Incremental indexing, staleness, legacy JSON import
- `src/core/code-query.test.ts` — FTS5 search, graph queries, budget retrieval
- `src/core/workspace.test.ts` — Plans, tasks, rules, branches, handoffs (SQLite-backed)
- `src/tunnel/manager.test.ts` — Tunnel lifecycle, port detection, auto-reconnect
- `src/sync/watcher.test.ts` — File watching, batching, deduplication, exclusions
- `src/sync/transfers.test.ts` — Bulk sync, incremental sync, remote delete
- `src/ssh/manager.test.ts` — Session creation, command execution, file upload
- `src/config/config.test.ts` — Config load/save, project CRUD, schema validation

## Architecture

**One SQLite database** (`.studio/studio.db`) holds all state:
- Code intelligence: `files`, `symbols`, `chunks`, `edges`, `imports` + `fts_chunks` (FTS5 virtual table)
- Workspace: `plans`, `tasks`, `rules`, `branches`, `handoffs`, `pinned_context`, `verify_state`
- Cost ledger: `cost_events` (per-message token usage + $ cost)

Connection is held for process lifetime (one per DB path). WAL mode + FTS5 enabled by default via `bun:sqlite`. No external dependencies.

All state lives in `.studio/studio.db` — no JSON files, no legacy migration paths.

**Query helpers** (`queryAll`, `queryOne`, `runQuery` in `studio-db.ts`) wrap `bun:sqlite`'s rest-param `.all(...params)` so callers can pass explicit arrays. Always use these instead of `db.query(sql).all([array])` to avoid typecheck issues.

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
    config.ts    Config file read/save, project CRUD
    schema.ts    Zod schemas for SSH, tunnel, project configs (incl. multi-remote)
    defaults.ts  Default config values and exclude patterns
    types.ts     TypeScript interfaces for all config types
    index.ts     Public API exports
  core/          Core logic (no I/O deps except where noted)
    studio-db.ts Unified SQLite connection (code index + workspace + cost ledger)
    studio-db-schema.sql  DDL reference (mirrored inline in studio-db.ts)
    code-store.ts  Incremental indexing into SQLite (mtime+sha256 staleness)
    code-query.ts  FTS5 search, graph queries (refs/impact/importers/hotspots)
    cost.ts       Token cost ledger — capture from message.updated, query, prune
    workspace.ts  Plans/tasks/rules/branches/handoffs/pins — backed by SQLite
    branch-context.ts  Git branch detection + branch switch notice
    discipline.ts Always-on studio discipline system prompt
    token-budget.ts  Dedup, compact, truncate helpers
    compress.ts   Large output compression with cache + path-traversal-safe retrieval
    model-routing.ts Autonomous per-agent model routing (free/balanced/quality) + prefer_local
    scout.ts         Autonomous improvement finder (injected unless autonomy=off)
  ssh/           SSH session manager
  sync/          File sync engine
  tunnel/        SSH tunnel w/ exponential-backoff watchdog + heartbeat
  hooks/         OpenCode plugin hooks
    session-start.ts  Event hook: cost capture, model fallback, auto-start
    discipline.ts     System prompt stable-prefix ordering + scout injection
    chat-message.ts   Model routing + rule capture + autonomy NL opt-out
    chat-params.ts    Temperature tiering + prompt cache key
    tool-guards.ts    Handoff gate + TDD gate hook
    compaction*.ts    Compaction continue + context injection
  tools/         MCP tools (studio_*)
  src/index.ts   Plugin entry — registers all tools + hooks
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
