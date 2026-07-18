# Changelog

## v2.0.0-alpha.1 (2026-07-18)

First public alpha of the SQLite rewrite. Publishes to npm as dist-tag **`alpha`** (does not replace `latest` 1.0.1).

### Added

- **`studio_scout`** + autonomy modes + `@studio-scout` / `/scout`
- **Prefer local models** for cheap/read-only subagents
- **Session spend cap** — `studio_preferences set_session_budget` (or say `budget $5`); blocks expensive tools when exceeded
- Plugin binds OpenCode `directory` (worktree-aware) via active-dir
- CI: per-file isolated tests (fixes mock.module pollution); prerelease npm publish with correct dist-tag

### Docs / packaging

- README install via `opencode-studio@alpha`
- package `exports` + files include README/LICENSE/CHANGELOG

---

## v1.0.0-alpha.1 (superseded)

Interim GitHub-only tag; replaced by v2.0.0-alpha.1 for npm semver (> 1.0.1).

---

First public alpha. Includes the full SQLite rewrite formerly developed on `v2-beta`, plus autonomy and local-model cost controls.

### Added

- **`studio_scout`** — autonomous improvement scout (verify failures, test gaps, polish, hotspots, open concerns)
- **Autonomy modes** — `studio_preferences set_autonomy full|suggest|off` (default `suggest`); natural language: "don't scout" / "be proactive"
- **`@studio-scout`** agent + `/scout` command
- **Prefer local models** — `studio_preferences set_prefer_local true` routes fast/read-only subagents to Ollama / LM Studio / local
- Discipline + help updated for verify-first autonomous development

### Docs

- README rewritten for public alpha positioning
- ROADMAP trimmed to shipped baseline + forward priorities
- Package version aligned to `1.0.0-alpha.1`

---

## v2.0.0-beta (2026-06-26)

The complete v2 rewrite. This is a breaking pre-release for private beta testing.

### ⚠️ Breaking changes

- **Storage migration: `workspace.json` → `studio.db` (SQLite)** — all workspace state (plans, tasks, rules, branches, handoffs, pins, verify) is now in SQLite. Old `.studio/workspace.json` is no longer read or written.
- **Storage migration: `code-index.db` → `studio.db`** — code intelligence now lives in the same unified database. Old `.studio/code-index.db` is no longer used.
- **Removed `importLegacyWorkspaceJson` and `importLegacyJson`** — legacy JSON migration code deleted entirely. v2 is pre-release; no migration supported.
- **Removed deprecated DB aliases** — `openCodeDb`, `closeCodeDb`, `codeDbPath`, `closeAllCodeDbs`, `closeCodeIndex` are gone. Use `openStudioDb`/`closeStudioDb`.
- **Removed `symbol-index.ts` re-export barrel** — import directly from `code-index.ts`.
- **Removed `buildSymbolIndex` alias** — use `buildCodeIndex`.
- **Removed `CodeChunk` interface** — use `ChunkRow` from `studio-db.ts`.
- **Schema is now in `studio-db-schema.sql`** (single source of truth) — no inline SQL in `studio-db.ts`.
- **`createWatcher` is now async** — callers must `await createWatcher(...)`.
- **`compressToolOutput` is now async** — callers must `await compressToolOutput(...)`.
- **`extractFromHtml` is now async** — callers must `await extractFromHtml(...)`.
- **Discipline prompt is auto-generated** from `tool-catalog.ts` — don't edit `STUDIO_DISCIPLINE` manually.
- **Agent prompts are auto-generated** from `AGENT_DEFS` + tool catalog — don't edit inline.
- **`tsconfig.json` stricter** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitReturns` enabled.
- **Logger module replaces `console.*`** — set `STUDIO_LOG_LEVEL=error` to silence info logs.

### Added — Core architecture

- Unified SQLite store (`.studio/studio.db`): code index + workspace state + cost ledger + LSP diagnostics
- Tree-sitter WASM AST (lazy-loaded on first use) with 30+ language grammars
- SQLite FTS5 full-text search with BM25 ranking + heuristic rerank
- Symbol graph: refs, importers, impact (transitive callers via recursive CTE), hotspots
- Token-budgeted retrieval with per-chunk token estimates
- Prompt-cache-stable system prompt ordering (stable prefix → dynamic suffix)
- Per-session output deduplication (auto-evicts after 30min TTL)
- Chunk whitespace stripping before storage (~10-15% token savings)
- Prompt cache key injected via `chat.params` hook

### Added — Tools (6 new: 40 total)

- `studio_cost` — per-session and all-time token usage + $ cost breakdown by model and agent
- `studio_git` — full git management: status, diff, log, blame, commit (auto-message), stash, branch, restore/rollback
- `studio_spec` — lightweight spec-driven development: generates requirements + acceptance + task breakdown
- `studio_refactor` — rename analysis, extract, callers, dead code detection, structure analysis
- `studio_deps` — dependency scanning: list, audit (OSV.dev keyless), outdated (npm/crates.io/PyPI keyless)
- `studio_remote` — SSH exec on remote hosts from `~/.ssh/config`

### Added — Smart automation (zero-config)

- Auto-detects 21+ project ecosystems (Python/Rust/Go/Java/Ruby/PHP/C/C++/etc.) and configures verify commands
- Auto-detects formatter/linter (prettier, eslint, ruff, rustfmt, golangci-lint, rubocop, etc.) and injects conventions
- LSP diagnostics captured in real-time from `lsp.client.diagnostics` events — agent knows about type errors without running typecheck
- `file.edited` → debounced incremental reindex (single-file re-parse, no full rebuild)
- `session.idle` → prunes old cost events (30d), stale diagnostics (1h), WAL checkpoint
- Cross-session resume card: synthesizes "continue where you left off" from last handoff + incomplete tasks + git branch
- Pre-flight cost preview: estimates cost for remaining work from historical data
- Self-healing verify: `studio_verify only=snapshot` saves HEAD, `only=rollback` auto-reverts on persistent failure
- Self-improving rule capture: "don't X" / "never Y" in chat → auto-saved project rule
- TDD gate hook: warns if no test file exists for active task before `studio_verify`
- Branch-aware context: tasks scoped per git branch
- Persistent plans: `.studio/plans/<id>.md` auto-exported on every save

### Added — Dynamic architecture (no manual prompt editing)

- `tool-catalog.ts` — single source of truth for all tool metadata (name, category, description, phase, when-to-use)
- Discipline prompt auto-generated from catalog — adding a tool to the catalog automatically updates the prompt
- Help `tools` topic auto-generated from catalog
- Agent system prompts auto-enriched from catalog descriptions
- `CODE_EXTENSIONS` derived from `EXT_TO_WASM` (single source of truth for supported languages)

### Added — Remote stack

- Exponential-backoff tunnel watchdog (1s→2s→4s→…→5min cap) with failure counter
- After 3 consecutive failures, discipline injects "tunnel down" notice
- Heartbeat triggers reconnect on half-open TCP
- Multi-remote per project: `add_remote_env` / `set_remote_env` actions

### Fixed — Critical bugs (17)

- SSH shell injection in `uploadFile` (unquoted `mv` command) — now uses `shellQuote`
- Edge resolution: `GROUP BY e.id` (was `e.dst_name` — only resolved 1 edge per symbol name)
- Edge mis-attribution: uses `symbol_idx` (was `symbolIds[0]` for all edges)
- `reindexFile` now calls `resolveEdges` (newly created edges stayed unresolved)
- `studio_verify` false success on empty command filter (now returns "no matching command")
- `studio_git status` porcelain v2 parsing (wrong XY field, wrong file extraction)
- Git commit auto-message: no longer treats `--stat` summary line as filename
- Git argument injection: refs starting with `-` rejected
- `cost_events.task_id` now stores actual task ID (was plan ID)
- Cost SUM not COALESCE'd → potential null crash in formatter
- Cost numeric fields default to 0 (was binding undefined)
- `recordVerifyFailure` now truly atomic (transaction wraps verify_state + plan revision)
- `foldBranch` now transactional + null-safe
- `deps.ts` Cargo/pyproject TOML regex truncation at inline `[`
- Unguarded awaits in `session-start.ts` → unhandled promise rejections
- `handleFallback` gated to relevant events (was running on every event)
- `currentBranch()` cached for 10s (was spawning `git rev-parse` every chat turn)

### Changed

- `compressToolOutput` uses async `Bun.write` (was sync `writeFileSync`)
- `studio_verify` now uses ecosystem-aware command aliases (clippy, ruff, rubocop for "lint")
- `studio_verify` now language-agnostic (was Node-only: reads Cargo.toml, pyproject.toml, go.mod, etc.)
- Code extensions increased from 48 to 80+ (Terraform, Protobuf, GraphQL, SQL, Solidity, Nim, Julia, etc.)
- `noUncheckedIndexedAccess: false` (enabled `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitReturns`)
- `web-tree-sitter`, `chokidar`, `turndown`/`readability`/`linkedom` lazy-loaded via dynamic `import()`
- All `console.*` calls replaced with leveled logger module
- All runtime `require()` calls replaced with ESM imports
- 35 orphan exports removed, duplicate exports consolidated

## v0.1.0 (2026-05-05)

### Added

- File sync engine using chokidar for file watching with 2-second debounce and event deduplication
- Bulk sync via tar piped over SSH on first connection (no rsync dependency)
- Incremental file sync via SSH stream with atomic writes (`.tmp` + `mv` pattern)
- Remote file deletion support through SSH
