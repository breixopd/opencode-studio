# opencode-studio

The one OpenCode plugin for replacing Cursor / Claude Code / Cline-style setups. Native first, keyless by default, token-cheap, fast on big repos, smart enough for small and local models.

**v1.0.0-alpha** — first public alpha.

```json
{ "plugin": ["/path/to/opencode-studio/dist/index.js"] }
```

Or after publish: `{ "plugin": ["opencode-studio"] }`

## Why

Common pain with similar products: runaway token cost, agents that wait to be asked, weak verification, and brittle context on large repos. Studio pushes the other way:

- **Autonomous scout** — finds polish, test gaps, and research opportunities without being asked (`studio_scout`). Opt out anytime: `studio_preferences set_autonomy off` or say "don't scout".
- **Verify-first** — `studio_handoff` blocked until `studio_verify` passes; grind loop + self-heal on repeated failure.
- **Cost awareness** — per-session/all-time ledger (`studio_cost`), pre-flight estimates, free/local routing for read-only subagents.
- **Native code intelligence** — tree-sitter + SQLite FTS5 graph (no embedding API required).

## Autonomy

| Mode | Behavior |
|------|----------|
| `suggest` (default) | Inject scout findings; act on high severity; suggest the rest |
| `full` | When idle, proactively fix high/medium items (tests + verify first) |
| `off` | No scout injection |

```
studio_preferences set_autonomy full|suggest|off
studio_preferences set_prefer_local true   # Ollama / LM Studio for cheap subagents
```

Recommended local tool-calling models on modest hardware: **Qwen3.5 4B**, **Qwen3 8B**, **Nemotron Nano 4B** via Ollama. For tiny sidekick routers, Cactus Compute Needle (26M) behind an OpenAI-compatible endpoint works as provider `local`.

## Model routing

| Mode | Behavior |
|------|----------|
| `balanced` (default) | Read-only → free Zen / local / fast tier; implement → your main model |
| `free` | Cheapest tier everywhere |
| `quality` | Main model for all subagents |

## Core capabilities

- **Unified SQLite** — `.studio/studio.db` (WAL + FTS5): index, workspace, cost ledger, diagnostics
- **Graph queries** — refs, importers, impact, hotspots via `studio_index`
- **SDLC team** — `@studio-explore` `@studio-research` `@studio-architect` `@studio-security` `@studio-implement` `@studio-review` `@studio-verify` `@studio-scout` `@studio-remote`
- **Remote** — SSH tunnel + file sync with exponential-backoff watchdog; `studio_remote` for remote exec
- **Memory** — project brief, rules, pinned context, persistent plans under `.studio/plans/`
- **Council** — `/council` or `council:` for multi-lens review

## Quick tools

`studio_scout` `studio_verify` `studio_index` `studio_cost` `studio_plan` `studio_task` `studio_handoff` `studio_preferences` `studio_doctor` `studio_help`

```bash
bun install && bun run build && bun test
```

See [ROADMAP.md](ROADMAP.md), [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md).

MIT
