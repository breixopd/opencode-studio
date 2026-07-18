# Tools & commands

**Source of truth for tools:** `src/core/tool-catalog.ts` (`TOOL_CATALOG`). This page mirrors the catalog (44 tools). When tools change, update the catalog first, then refresh this page.

In-session: `studio_help topic=tools`.

Agents call `studio_*` tools. Slash commands prompt the agent to call them (see below).

---

## Code

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_index` | 1 | Unified code intelligence: search, semantic, similar, research, symbols, refs, importers, impact, hotspots, monorepo | Any code query — BM25 + AST graph |
| `studio_grep` | 1 | Ripgrep search (instant, needs `rg` on PATH) | Quick text search before building index |
| `studio_glob` | 1 | Find files by pattern (e.g. `**/*.ts`) | Files, not content |
| `studio_symbols` | 1 | AST symbol index — search/file/outline/stats/rebuild | Symbol-level navigation |
| `studio_code_search` | 2 | Public GitHub code search (not local workspace) | How others implement a pattern |
| `studio_constitution` | 3 | Generate coding standards from project analysis | Project constitution injection |
| `studio_deps` | 6 | Dependency scanning: list, audit (OSV.dev), outdated | Security audit or updates |
| `studio_council` | 8 | Multi-lens ensemble review | Complex/security-sensitive changes |
| `studio_refactor` | 9 | Refactor planning: rename, extract, callers, dead code | Before structural edits |
| `studio_browser` | 10 | Browser verification via system Chrome (headless) | Web apps after changes |

## Git

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_git` | 10 | status, diff, log, blame, commit, stash, branch, restore/rollback | Any git op with parsed output |

## Web

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_search` | 2 | DuckDuckGo (keyless) or Tavily if key, with scraping | Research APIs/docs |
| `studio_fetch` | 2 | URL → markdown (SSRF-safe) | Read one URL |
| `studio_crawl` | 2 | Bounded same-origin crawl | Multi-page docs |

## SDLC

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_spec` | 3 | Structured requirements + acceptance + task breakdown | Before non-trivial features |
| `studio_plan` | 4 | Create/read/list/activate/revise plans | Structure before coding |
| `studio_task` | 7 | Task board with acceptance criteria | Atomic work units |
| `studio_branch` | 7 | Context fold + git worktrees | Parallel isolation |
| `studio_scout` | 9 | Autonomous improvement scout | Idle / polish discovery |
| `studio_verify` | 10 | test/lint/typecheck/build + snapshot/rollback | Before handoff |
| `studio_handoff` | 11 | Structured handoff summary | End session / next agent |

**Gate:** `studio_handoff` requires verify pass (unless `force:true`).

## Memory

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_brief` | — | Project identity/stack/conventions | Set/review context |
| `studio_remember` | — | Rules + auto-memory topics | Persist learnings |
| `studio_memory` | — | Search plans, handoffs, folded branches | Prior decisions |
| `studio_context` | — | Pin/unpin blocks across compaction | Critical facts |
| `studio_retrieve` | — | Fetch compressed tool outputs | When you see retrieve ids |

## Config

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_preferences` | — | Mode, autonomy, local, budget, remote policy, … | Change settings |
| `studio_models` | — | Sync providers / Zen catalog | After provider changes |
| `studio_setup` | — | Onboard (budget/local) + SSH bind | First run |
| `studio_add_project` | — | Local→remote mapping | Add sync project |
| `studio_remove_project` | — | Remove mapping | Cleanup |
| `studio_list_projects` | — | List mappings | Inventory |
| `studio_agent` | — | List/sync/create/remove agent profiles | Custom subagents |

## Remote

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_remote` | — | SSH exec (blocklist + optional allowlists) | Remote tests/GPU/DB |
| `studio_sync_start` | — | Start real-time SSH file sync | Manual sync start |
| `studio_sync_stop` | — | Stop file sync | Manual sync stop |
| `studio_tunnel_status` | — | Check SSH tunnel status | Tunnel health |
| `studio_tunnel_restart` | — | Restart SSH tunnel | Tunnel down |
| `studio_status` | — | Runtime snapshot: projects, tunnel, sync | Overall health |

See [Security](./security.md) for remote policy.

## Cost

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_cost` | — | Per-session and all-time $ + tokens | Check spending |

See [Budget](./budget.md).

## Health

| Tool | Phase | Description | When to use |
|------|-------|-------------|-------------|
| `studio_doctor` | — | Config, SSH, index, models, Ollama, … | Something broken |
| `studio_report` | — | JSON smoke-test bundle | Debug paste |
| `studio_help` | — | Topic-based help | Discover features |
| `studio_ci` | — | GitHub Actions status / triage / watch | CI failures |

---

## Slash commands

Injected via `src/hooks/config-inject.ts` (OpenCode `config.command`). Canonical names have **no** `/studio-` prefix.

| Slash | Behavior |
|-------|----------|
| `/onboard` | First-run setup (`studio_setup` onboard) |
| `/budget` | Set / disable / status session budget |
| `/help` | `studio_help topic=…` |
| `/start-work` | Full SDLC fan-out |
| `/deep-dive` | `@studio-explore` |
| `/research` | `@studio-research` |
| `/architect` | `@studio-architect` |
| `/security` | `@studio-security` |
| `/review` | `@studio-review` |
| `/plan` | `studio_plan write` |
| `/verify` | `@studio-verify` → `studio_verify` |
| `/handoff` | `studio_handoff` |
| `/scout` | `@studio-scout` |
| `/council` | `studio_council action=review` |
| `/council-plan` | `studio_council action=plan` |
| `/smoke-test` | Multi-step smoke script |

The TUI palette may list `/studio-*` aliases; prefer the table above.

## Agents

| Agent | Role |
|-------|------|
| `@studio-explore` | Read-only exploration |
| `@studio-research` | Docs / examples |
| `@studio-architect` | Architecture / plan review |
| `@studio-security` | Security review |
| `@studio-implement` | Implement (verify-first) |
| `@studio-review` | Code review |
| `@studio-verify` | Run verification |
| `@studio-remote` | SSH sync / exec |
| `@studio-scout` | Autonomous polish scout |

## Natural-language intents

| Intent | Examples | Effect |
|--------|----------|--------|
| Budget | `budget $5`, `disable budget`, `budget off` | Set or clear session budget |
| Autonomy | `don't scout`, `be proactive`, `suggest only` | Change autonomy mode |
| Council | `council: review auth` | Keyword trigger (prefer `/council` for reliability) |

---

## Maintainer note

Diff this page against `TOOL_CATALOG` and `createConfigInjectHook` when adding tools or slash commands.
