# Getting started

OpenCode Studio is an OpenCode plugin that adds:

- Native code intelligence (SQLite + tree-sitter; no embedding API required)
- SDLC workflow (spec → plan → tasks → verify → handoff)
- Cost awareness (session budget + ledger)
- Optional remote SSH sync/exec
- Autonomous improvement scout (opt out anytime)

## Prerequisites

- [OpenCode](https://opencode.ai/docs/) with at least one model provider
- A git repository as the project root (recommended)
- Optional: [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) for `studio_grep`
- Optional: SSH `Host` in `~/.ssh/config` for remote sync
- Optional: Ollama / LM Studio / llama.cpp for cheap local subagents

## Install (alpha)

In `~/.config/opencode/opencode.json` (or project `opencode.json`):

```json
{
  "plugin": ["opencode-studio@alpha"]
}
```

Until stable, npm `latest` may still be 1.x — use the `alpha` dist-tag.

Local development build:

```bash
bun install && bun run build
```

```json
{
  "plugin": ["/absolute/path/to/opencode-studio/dist/index.js"]
}
```

Restart OpenCode after changing plugins.

## First five minutes

### 1. Open your repo and start a session

Studio initializes `.studio/studio.db` and injects agents/commands.

### 2. Onboard (budget + local)

On first session Studio asks once about a spend cap (soft default **$5** until you confirm).

```text
/studio-onboard
/studio-budget 5
/budget off
```

Or say `budget $5` / `disable budget`. Or:

```text
studio_setup({ action: "onboard", budget_usd: 5 })
studio_setup({ action: "onboard", disable_budget: true })
```

Details: [Budget](./budget.md).

### 3. Prefer local models (optional)

1. Run Ollama / LM Studio / llama.cpp with an OpenAI-compatible `/v1` endpoint
2. Add it as an OpenCode provider
3. `studio_preferences set_prefer_local true`

### 4. Health check

```text
studio_doctor
```

### 5. Do real work

| Goal | Command |
|------|---------|
| Full SDLC | `/studio-start-work <goal>` |
| Explore | `/studio-deep-dive <question>` |
| Plan | `/studio-plan <goal>` |
| Verify | `/studio-verify` |
| Handoff | `/studio-handoff` |
| Help | `/studio-help` or `studio_help topic=overview` |

## Mental model

1. **Slash commands** — primary `/studio-*` (short aliases like `/verify` still work)
2. **Tools** — agent calls `studio_verify`, `studio_cost`, …
3. **Natural language** — e.g. `don't scout`, `budget $10`, `I accept the risk`

Prefer slash or tools when you want deterministic behavior.

## Autonomy (scout)

Default mode is **suggest**: Studio surfaces polish/test/research opportunities via `studio_scout`.

| Mode | Behavior |
|------|----------|
| `suggest` (default) | Inject findings; act on high severity; suggest the rest |
| `full` | When idle, proactively fix high/medium (verify-first) — requires risk accept + TUI toast |
| `off` | No scout injection |

```text
studio_preferences accept_autonomy_risk
studio_preferences set_autonomy full accept_risk:true
studio_preferences set_autonomy off
```

Or say `don't scout` / `I accept the risk` / `revoke autonomy risk`. See [Security](./security.md).

## Optional: SSH remote

1. Ensure `~/.ssh/config` has a `Host` alias
2. `studio_setup({ host: "my-alias" })`
3. Check with `studio_status` / `studio_doctor`
4. Exec with `studio_remote` (destructive patterns always blocked; optional allowlists)

See [Security](./security.md).

## Next

- [Budget](./budget.md) · [Security](./security.md) · [Tools](./tools.md) · [Architecture](./architecture.md)
