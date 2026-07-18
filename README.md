# opencode-studio

The one OpenCode plugin for replacing Cursor / Claude Code / Cline-style setups. Native first, keyless by default, token-cheap, fast on big repos, smart enough for small and local models.

**v2.0.0-alpha** — first public alpha of the SQLite rewrite (npm dist-tag `alpha`; npm `latest` is still 1.0.1 until stable).

```json
{ "plugin": ["opencode-studio@alpha"] }
```

Or local build: `{ "plugin": ["/path/to/opencode-studio/dist/index.js"] }` after `bun install && bun run build`.

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
studio_preferences set_prefer_local true   # use connected Ollama / LM Studio when present
studio_preferences set_session_budget 5    # hard spend cap ($) — default $5 if never set; 0 = unlimited
```

Local routing does **not** hardcode model names — connect Ollama / LM Studio / any OpenAI-compatible local provider and Studio picks from the models you have loaded (same pattern as Zen/provider auto-routing).

## Local OpenAI-compatible sidecar

Run a local OpenAI-compatible server, point OpenCode at it, then prefer local models for cheap/read-only subagents:

1. **Start a sidecar** (pick one):
   - [Ollama](https://ollama.com) — `ollama serve` (default `http://127.0.0.1:11434`)
   - [LM Studio](https://lmstudio.ai) — start the local server (often `http://127.0.0.1:1234/v1`)
   - [llama.cpp](https://github.com/ggerganov/llama.cpp) server — `--port 8080` with OpenAI-compatible `/v1`

2. **Add an OpenAI-compatible provider** in OpenCode config (example for Ollama):

```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": { "llama3.2": { "name": "Llama 3.2" } }
    }
  }
}
```

3. **Prefer local routing** in Studio:

```
studio_preferences set_prefer_local true
```

`studio_doctor` lightly probes Ollama on `:11434` (optional — missing Ollama does not fail health).

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

## Publish / CI

- Push to `main` → build + typecheck + **isolated per-file tests**
- Tag `v*` → same tests, then `npm publish`
  - Prerelease versions (`2.0.0-alpha.2`) → dist-tag `alpha` (does not move `latest`)
  - Stable versions → dist-tag `latest`

**npm auth:** Prefer [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) on the package settings:

1. npmjs.com → `opencode-studio` → Settings → Trusted Publisher  
2. GitHub user `breixopd`, repo `opencode-studio`, workflow filename **`ci.yml`**  
3. Or refresh the `NPM_TOKEN` GitHub secret (granular token with publish permission)

```bash
bun install && bun run build && bun test
```

See [ROADMAP.md](ROADMAP.md), [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md).

MIT
