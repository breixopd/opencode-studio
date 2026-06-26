# OpenCode Studio v2 — Roadmap to "holy grail" plugin

> North star: **the only plugin a developer needs to ditch Cursor / Claude Code / Cline setups.**
> Native first, keyless by default, token-cheap, fast on big repos, smart enough for small models.

This document is the master plan. Phases are sequenced by dependency, not by impressiveness.
Private beta for ~1 month before public release. No feature ships without tests.

---

## Guiding principles (non-negotiable)

1. **Native first** — no third-party indexers (ChunkHound is gone), no embedding APIs by default,
   no external programs the user must install.
2. **Keyless by default** — DuckDuckGo + local AST + ripgrep work with zero config.
   Optional `TAVILY_API_KEY` is the only key a user might add.
3. **Token-cheap** — every tool returns ranges, not whole files. Budget-aware retrieval everywhere.
   Stable system prompts for prompt cache hits. Cheap reads, expensive writes.
4. **Resource-light** — lazy module loads (tree-sitter WASM never loaded until needed),
   workers for CPU work, mtime-only invalidation, WAL-mode SQLite.
5. **Smart enough for small models** — index gives Haiku/Flash/mini models the structure they need
   without reading whole files.
6. **One source of truth** — source files. Everything in `.studio/` is a disposable cache.
   No dual JSON/SQLite paths.

---

## Phase 0 — Foundations (DONE)

- [x] tree-sitter WASM multi-language AST (30+ languages, lazy load)
- [x] BM25 over AST chunks (initial implementation in JS)
- [x] Multi-hop research (symbols + grep refs)
- [x] Model routing: 3-tier (free/balanced/quality), Zen catalog, provider-change detection
- [x] Web stack: DuckDuckGo + Tavily + readability + crawl
- [x] `studio_help`, `studio_doctor`, `studio_report`, `studio_models`
- [x] ChunkHound fully removed
- [x] Plugin bundle 1.81MB (tree-sitter + chokidar + web-extract trio lazy-loaded)

---

## Phase 1 — SQLite code intelligence (FOUNDATION — unblocks everything)

JSON breaks above ~500 files. SQLite + FTS5 is the right long-term substrate.
`bun:sqlite` ships with FTS5 enabled by default — zero new dependencies.

### Schema (`src/core/code-db-schema.sql`)

Tables: `files`, `symbols`, `chunks`, `edges`, `imports`, `meta`, plus `fts_chunks` virtual table.

Key design choices:
- External-content FTS5 (halves storage — text in `chunks`, index in `fts_chunks`)
- Cascade deletes from `files` (atomic file replacement)
- Denormalized `in_degree`/`out_degree` on symbols (1-index read instead of COUNT GROUP BY)
- `edges.dst_id NULL + dst_name TEXT` — unresolved references kept, not faked
- Separate `imports` table (file-to-file) vs `edges` (symbol-to-symbol)

### Files

- `src/core/code-db-schema.sql` — DDL
- `src/core/code-db.ts` — connection, pragmas (WAL, mmap, cache_size), prepared statements
- `src/core/code-store.ts` — `findStaleFiles`, `indexFile`, `replaceFileData`, `resolveEdges`
- `src/core/code-query.ts` — `searchFts`, `findRefs`, `findImporters`, `findImpact`, `retrieveWithBudget`

### Incremental indexing

Three tiers of decreasing cost:
1. **CHEAPEST**: stat() mtime+size compare — skip 99% of unchanged files
2. **MEDIUM**: mtime changed → sha256 to confirm (false positive from `touch`)
3. **EXPENSIVE**: hash changed → re-parse with tree-sitter, atomic replace

This is the single biggest perf win. Current JSON rewrites the whole file on every rebuild.

### Migration (atomic, no dual path)

Per `no-legacy-backcompat.mdc`:
- Swap `code-index.ts` to delegate to SQLite in one commit
- Delete `code-search.ts` (custom JS BM25 — FTS5's `bm25()` replaces it)
- One-shot JSON importer: if `.studio/code-index.json` exists on next start, import then unlink
- Update `.gitignore` for `.studio/code-index.db*` (covers `-wal`/`-shm`)

### Pragmas (set at connection)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;  -- 256MB memory-mapped I/O
PRAGMA cache_size = -65536;    -- 64MB page cache
PRAGMA wal_autocheckpoint = 1000;
PRAGMA busy_timeout = 5000;
```

---

## Phase 2 — Graph queries (the differentiator)

This is what JSON cannot do. With the `edges` + `imports` tables:

- `studio_index action=refs query="routeAgent"` — who calls X
- `studio_index action=importers query="src/core/code-index.ts"` — who imports this file
- `studio_index action=impact query="routeAgent"` — transitive callers (depth 3, recursive CTE)
- `studio_index action=hotspots` — most-referenced symbols (architecture hotspots)

Edge resolution strategy:
- Symbol→symbol: by name within repo (ambiguous names stay unresolved)
- File→file imports: suffix match (denfry's `de3082a` pattern — 7-28× faster than LIKE scans)

---

## Phase 3 — Token optimization (PRIORITY — user explicitly asked)

### 3.1 Budget-aware retrieval

Every query returns `file:line_start:line_end` ranges with `token_est` precomputed.
Agent fetches only what it needs. Replaces current `48_000` char hard cap with structured ranges.

### 3.2 System prompt stability (prompt cache hits)

Anthropic & OpenAI both cache stable prefixes. Audit `discipline.ts` + `config-inject.ts`:
- Stable parts (discipline, agent prompts) at the **start**
- Dynamic parts (project profile, pending notices, open tasks) at the **end**
- Inject `prompt_cache_key` via `chat.params` when supported

### 3.3 Tool output dedup + compaction

- Track seen tool outputs by content hash; skip re-injecting identical results
- Compress large outputs to summary + retrieve-by-id (already in `compress.ts` — extend)
- Strip whitespace/comments from code chunks before returning

### 3.4 Cross-encoder rerank

BM25 returns candidates; a tiny rerank step (could be heuristic — symbol match > file match >
recency) cuts the result set before sending. Saves tokens on false positives.

### 3.5 Just-in-time context loading

Don't dump outline of all files. Return file list + symbol names; agent calls
`studio_symbols action=outline file=X` only when actually editing X.

### 3.6 Per-task cost ledger

`studio_cost` tool backed by SQLite, attributes tokens to `(session, task, branch, file)`.
Surface `/cost` summary at session end. **#1 user complaint post-Copilot-UBB.**

---

## Phase 4 — Performance & resource efficiency

### 4.1 Worker pool for parsing

`Bun.spawn` is for external processes. For CPU work use `new Worker(new URL("./parser-worker.ts", import.meta.url))`.
1 worker per core, work-stealing queue, batch N files per message to amortize `postMessage`.

### 4.2 Dynamic import tree-sitter ✅ DONE

`await import("web-tree-sitter")` only when first `studio_symbols` / `studio_index` runs.
Sessions that never index pay zero WASM load cost. Also applies to `chokidar` (sync)
and the web-extract trio (`turndown`/`readability`/`linkedom`).

### 4.3 Memory hygiene

- `tree.delete()` after every parse (currently leaks on 100k-file reindex)
- `query.delete()` after structural search
- LRU cache for parsed grammars (already done)

### 4.4 Bun-native primitives

| Current | Switch to |
|---------|-----------|
| `readdirSync` recursive | `Bun.Glob` scan (3KB native) |
| `writeFileSync` for cache | `Bun.write` (auto copy_file_range) |
| `crypto.createHash` | `Bun.CryptoHasher` (BLAKE3 if available) |
| `fs.readFile` | `Bun.file().text()` lazy refs |

### 4.5 Watcher (optional, for live reindex)

Prefer Bun-native `fs.watch` over chokidar (FSEvents on macOS, inotify on Linux, native).
200ms debounce, ignore at OS level not in callback.

### 4.6 Process lifecycle

- Workers shut down on 5min idle (`worker.terminate()`)
- SQLite handles closed on `beforeExit` (WAL checkpoint flush)
- Lazy background warming — never parse if user never uses index tools

---

## Phase 5 — Orchestration (build all, sequenced by deps)

### 5.1 Task board upgrade (foundation)

`studio_task` gains: `depends_on`, `claimed_by`, `status` (queued/claimed/done/blocked).
Open queue injected into discipline system context. All agents see the same queue.

### 5.2 Validation chain

`studio-implement` output → auto-spawn `@studio-verify` → handoff blocked until pass.
Stronger than current gate. Uses OpenCode Task tool pattern.

### 5.3 Parallel fan-out

On non-trivial plans (heuristic: >3 steps OR mentions auth/security/perf), `/start-work`
spawns explore + security + architect concurrently, synthesizes before plan.

### 5.4 Git worktree isolation

`studio_branch` creates worktree automatically. `studio-implement` scoped to worktree.
Prevents merge conflicts when running parallel implement agents (Cursor v3 pattern).

---

## Phase 6 — Remote (user-requested)

### 6.1 Auto-heal tunnel/sync

Watchdog with exponential backoff (1s → 2s → 4s → ... → 5min cap).
After 3 consecutive failures, discipline injects: "tunnel down 3x — run studio_tunnel_restart".
No LLM call for monitoring — pure background setInterval.

### 6.2 Multi-remote per project

```typescript
projects[name].remotes: { dev: {...}, staging: {...} }
studio_preferences set_remote_env=staging
```

### 6.3 studio_remote run ✅ DONE

SSH exec for running commands on a remote box. `studio_remote` connects to hosts from
`~/.ssh/config` and runs arbitrary shell commands. Useful when local box can't run the
stack (DB, GPU, etc.).

---

## Phase 7 — Innovation (the differentiators)

### Tier S — ship first (highest impact/effort)

1. **Branch-aware context** — tag cached symbols, memories, chunks with `git branch`.
   On branch switch, scope swaps automatically. **No tool currently does this.**

2. **Persistent plans** — `.studio/plans/<task-id>.md` with structured frontmatter.
   Next session resumes instead of re-deriving. **Solves Claude Code's #1 complaint.**

3. **Per-task cost ledger** — see Phase 3.6. Timing is perfect post-Copilot-UBB backlash.

4. **TDD gate hook** — `tool.execute.before` on `studio_verify` checks: failing test exists
   for this task before commit? If not, block. **50 lines, ships a feature no competitor has.**

5. **Self-improving rule capture** — when user says "no, don't X" or reverts agent change,
   extract rule, write to `.studio/rules/<hash>.md`, start injecting. **Genuinely novel.**

### Tier A — ship next

6. **Self-healing verify loop** — snapshot HEAD, run tests, on failure feed log to agent
   with retry budget (3), on persistent failure auto-revert + queue for human review.

7. **Cross-repo dependency graph** — queryable substrate for monorepos / multi-repo.
   `studio_deps why <symbol>`, `studio_deps blast-radius <file>`.

8. **Pre-flight cost preview** — `chat.params` hook injects estimated cost range before run.
   "This task ~$0.40–1.20. Proceed?"

9. **Always-on PR/CI watcher** — `studio_watch` polls GitHub Actions on 30s interval,
   on failure spawns background session to triage. Local-first alternative to Bugbot.

10. **Constitution generator** — `studio_constitution` one-shot emits coding standards
    from repo analysis, injected by discipline forever after.

### Tier B — explore later

11. In-loop browser verification for web features (Playwright screenshot → agent)
12. Memory with confidence weighting + semantic recall (sqlite-vec embeddings)
13. Auto-rollback on test failure (simpler version of #6)
14. Spec-driven development automation (csdd-style)

---

## Phase 8 — Polish for release

- [ ] README rewrite (position vs Cursor/Claude Code/Cline)
- [ ] CONTRIBUTING update (SQLite schema, dev workflow)
- [ ] `.gitignore` for `.studio/code-index.db*`
- [ ] Token cost comparison doc (before/after measurements)
- [ ] Performance benchmarks (100 file repo, 1k, 10k, 50k)
- [ ] Migration guide (v1 → v2 for existing users)
- [ ] Smoke test expanded to cover SQLite + workers + cost ledger
- [ ] `studio_help` covers all new features

---

## Sequencing summary

```
Phase 1 (SQLite foundation)     ← START HERE
   ↓ unblocks
Phase 2 (graph queries) + Phase 3 (token opt) + Phase 4 (perf)
   ↓ in parallel
Phase 5 (orchestration) + Phase 6 (remote)
   ↓
Phase 7 Tier S innovations (parallel with above where independent)
   ↓
Phase 8 polish → private beta → public release
```

Each phase is independently shippable. No phase blocks another except Phase 1 → Phase 2.

---

## Reference implementations studied

- **Cymbal** (1broseidon/cymbal) — SQLite + FTS5 + tree-sitter, impact queries
- **codebase-index** (denfry/codebase-index) — hybrid FTS5 + graph + token budgets
- **code-symbol-index** (hit9/code-symbol-index) — mtime+size incremental
- **Probe** (probelabs/probe) — AST + BM25, zero index setup
- **Context Sherpa** — SCIP + ast-grep tiered analysis
- **dora** (butttons/dora) — Bun + bun:sqlite + web-tree-sitter (proven stack)
- **ast-grep** — structural pattern matching (fallback query layer)

Borrowed patterns, not code. License-compatible (MIT).
