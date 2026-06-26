# opencode-studio

The one plugin a developer needs to ditch Cursor / Claude Code / Cline setups. Native first, keyless by default, token-cheap, fast on big repos, smart enough for small models.

```json
{ "plugin": ["/path/to/opencode-studio/dist/index.js"] }
```

No `opencode-mem`, `oh-my-openagent`, `opencode-ssh-session`, or search MCPs needed.

## What's new in v2

- **Unified SQLite store** — `.studio/studio.db` (WAL + FTS5) holds everything: code index, workspace state, and the cost ledger. No more `workspace.json` rewriting the whole blob on every write.
- **Graph queries** — `studio_index` now gives you refs (who calls X), importers (who imports this file), impact (transitive callers), and hotspots (most-referenced symbols). Powered by SQLite recursive CTEs.
- **Per-task cost ledger** — `studio_cost` captures token usage and $ cost from every assistant message, attributed to session/agent/model/branch/task. Real-time, no background processes.
- **Prompt-cache-stable ordering** — system prompt blocks ordered so stable prefixes (discipline + project identity + rules) hit the cache, dynamic suffixes (plan/tasks/verify) don't invalidate it.
- **Branch-aware context** — tasks are scoped per git branch. Switching branches swaps the active task list automatically.
- **Exponential-backoff tunnel watchdog** — auto-reconnects with 1s→2s→4s→…→5min backoff. After 3 consecutive failures, injects a discipline notice. No more silent dead tunnels.
- **studio_remote** — SSH exec for running verify/tests on a remote box (when local can't run the stack).
- **Self-improving rule capture** — when you say "don't X" or "never Y" in chat, studio auto-captures it as a rule for future sessions.
- **TDD gate hook** — warns if no test file exists for the active task before `studio_verify`.
- **Persistent plans** — `.studio/plans/<id>.md` exported on every save for human/cross-session review.

## Autonomous model routing

No `oh-my-openagent.json`. Studio picks models per subagent based on **your connected providers** and **model mode** (`studio_preferences set_model_mode`).

| Mode | Behavior |
|------|----------|
| `balanced` (default) | Read-only subagents → free Zen when connected, else provider fast tier. Implement/review → your main model. |
| `free` | Cheapest tier everywhere (Zen free models preferred). |
| `quality` | Main model (or strongest tier) for all subagents. |

**Zen + Anthropic together:** main session can be `anthropic/claude-sonnet-4-6` while `@studio-explore` uses `opencode/deepseek-v4-flash-free` — no config edits.

**Anthropic only:** explore → `claude-haiku-4-5`, implement inherits your main model.

Per-agent `model` in `opencode.json` always wins. Connect providers via `/connect`.

## Harness features (Cursor / Claude Code inspired)

- **Verify gate** — `studio_handoff` blocked until `studio_verify` passes
- **Grind loop** — verify failure suggests `@studio-implement` retry (up to 3)
- **Pinned context** — `studio_context pin` survives compaction
- **Compaction continue** — open tasks / failed verify auto-continue after compact
- **Task-aware routing** — trivial plans downgrade architect/security to fast tier
- **Prompt-cache-stable** — stable prefix ordering for Anthropic/OpenAI cache hits
- **Per-session dedup** — identical tool outputs skipped within a session (not across sessions)

## Cross-session memory

All state lives in `.studio/studio.db` (SQLite). One source of truth — no dual JSON/SQLite paths.

| Layer | Where | Tool |
|-------|-------|------|
| Project identity | `~/.config/opencode-studio/projects/*.json` | `studio_brief` |
| Global user rules | `~/.config/opencode-studio/user.json` | `studio_remember` scope=global |
| Repo workspace | `.studio/studio.db` | `studio_plan`, `studio_task`, `studio_memory` |
| Plan exports | `.studio/plans/<id>.md` | `studio_plan` (auto-exported) |
| Cost ledger | `.studio/studio.db` (cost_events table) | `studio_cost` |

New sessions auto-load project brief, completed work, open concerns, and active plan.

## Code intelligence

Native: tree-sitter WASM AST (30+ languages) + SQLite FTS5 + graph edges. No embedding APIs, no third-party indexers.

```
studio_index action=search query="routeAgent"       # ripgrep (instant, no index)
studio_index action=semantic query="model routing"   # BM25 over AST chunks
studio_index action=research query="how does sync work"  # multi-hop: FTS + refs + importers
studio_index action=symbols query="createSession"   # AST symbol lookup
studio_index action=refs query="routeAgent"         # who calls this symbol?
studio_index action=importers query="src/core/code-index.ts"  # who imports this file?
studio_index action=impact query="openStudioDb"    # transitive callers (depth 3)
studio_index action=hotspots                         # most-referenced symbols
```

Token-budgeted retrieval: every query returns `file:line_start:line_end` ranges with `token_est`. Heuristic rerank boosts exact symbol matches. Chunk whitespace stripped before storage.

## Cost ledger

```
studio_cost                               # this session's total
studio_cost this_session=false             # all-time across all sessions
studio_cost since_hours=24                 # last 24 hours
studio_cost prune=true                    # delete events older than 30 days
```

Captures: input/output/reasoning/cache tokens, $ cost, model, provider, agent, branch. Idempotent on message_id (dedupes re-emitted events).

## SDLC team (subagents)

`@studio-explore` `@studio-research` `@studio-architect` `@studio-security` `@studio-implement` `@studio-review` `@studio-verify` `@studio-remote`

`/start-work` runs the full loop: understand → research → plan → architect/security → tasks → implement → review → verify → handoff.

## Remote

Auto-starts SSH tunnel + file sync on session start. Tunnel has exponential-backoff watchdog.

```bash
studio_setup                    # first-time SSH/project mapping
studio_sync_start / stop        # manual sync control
studio_tunnel_status / restart  # tunnel control
studio_remote host=dev-server command="bun test"  # run on remote box
studio_preferences add_remote_env staging remote=/app  # multi-remote
studio_preferences set_remote_env staging  # switch active env
```

## Tools

`studio_search` `studio_fetch` `studio_code_search` `studio_crawl` `studio_grep` `studio_glob` `studio_symbols` `studio_index` `studio_brief` `studio_remember` `studio_memory` `studio_context` `studio_plan` `studio_task` `studio_branch` `studio_verify` `studio_handoff` `studio_cost` `studio_remote` `studio_preferences` `studio_models` `studio_setup` `studio_doctor` `studio_report` `studio_help` `studio_status` `studio_add_project` `studio_remove_project` `studio_sync_*` `studio_tunnel_*` `studio_retrieve`

```bash
bun run build && bun test
```

MIT
