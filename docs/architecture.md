# Architecture

Short overview of plugin layers. Detail lives in source under `src/`.

## Shape

```
OpenCode host
  └─ Plugin entry: src/index.ts (+ optional src/tui.ts)
       ├─ REGISTERED_TOOLS (~44 tools)     → tools/*
       └─ hooks (config, chat, system, …)  → hooks/*
            └─ domain logic                → core/*
                 ├─ config                 → config/*
                 └─ remote infra           → ssh/ · sync/ · tunnel/
```

**Dependency direction (intended):**  
`index → tools/hooks → core → (config | sync | ssh | tunnel)`

## Layers

| Layer | Path | Role |
|-------|------|------|
| Entry | `src/index.ts`, `src/tui.ts` | Register tools + hooks; optional TUI |
| Hooks | `src/hooks/` | Session lifecycle, prompt injection, tool guards, config inject |
| Tools | `src/tools/` | OpenCode `tool()` wrappers (I/O boundary) |
| Core | `src/core/` | SQLite, index, budget, scout, routing, SDLC state |
| Config | `src/config/` | `~/.config/opencode-studio/config.json` |
| Remote | `src/ssh/`, `src/sync/`, `src/tunnel/` | SSH exec, file sync, port forward |

## Core clusters

| Cluster | Examples |
|---------|----------|
| Code intelligence | `code-store`, `code-query`, `tree-sitter-parser`, `monorepo` |
| Workspace / SDLC | `workspace-*`, plans, tasks, verify gate |
| Cost / budget | `cost`, `budget`, `budget-intent` |
| Autonomy | `scout`, `discipline`, `constitution` |
| Model routing | `model-routing`, `model-registry`, `agent-defs` |
| Catalog | `tool-catalog` — SSOT for tool metadata |

## Data store

One SQLite database: `.studio/studio.db` (WAL + FTS5).

- Code index: files, symbols, chunks, edges, imports + FTS
- Workspace: plans, tasks, rules, branches, handoffs, pins, verify state
- Cost ledger: `cost_events`
- Diagnostics / CI summary tables as used by doctor and scout

## Hooks (high level)

| Hook | Purpose |
|------|---------|
| `config-inject` | Agents + slash commands from `AGENT_DEFS` |
| `discipline` | System prompt blocks (budget, scout, tunnel notices) |
| `chat-message` | Budget/autonomy NL intents, routing, rule capture |
| `tool-guards` | Handoff gate, TDD warn, budget assert |
| `session-start` | Cost capture, auto-start sync/tunnel, prefetch |
| Compaction / compress | Context survival + output compression |

## Related

- [Tools](./tools.md) — full tool + command surface
- [Budget](./budget.md) · [Security](./security.md)
- [CONTRIBUTING](../CONTRIBUTING.md) — project structure for contributors
