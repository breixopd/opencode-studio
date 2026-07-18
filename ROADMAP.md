# OpenCode Studio — Roadmap

> North star: **the only plugin a developer needs to ditch Cursor / Claude Code / Cline setups.**
> Native first, keyless by default, token-cheap, fast on big repos, smart enough for small models.

Shipped baseline = **v2.0.0-alpha** (SQLite rewrite + post-alpha backlog below).

---

## Guiding principles

1. **Native first** — no third-party indexers, no embedding APIs by default
2. **Keyless by default** — DuckDuckGo + local AST + ripgrep; optional `TAVILY_API_KEY`
3. **Token-cheap** — ranges not whole files; stable system prompts for cache hits
4. **Resource-light** — lazy WASM, WAL SQLite, mtime incremental index
5. **Smart for small models** — structure via index so Haiku/Flash/local models can work
6. **Autonomous by default** — scout improvements unless the user opts out
7. **Verify-first** — tests + `studio_verify` before handoff; grind + self-heal on failure

---

## Shipped (alpha)

- Unified SQLite store (`.studio/studio.db`): code index + workspace + cost ledger + diagnostics
- Graph queries: refs / importers / impact / hotspots + **monorepo** cross-package imports
- Parallel index build (promise pool, configurable concurrency)
- SDLC team + `/start-work` fan-out, verify gate, grind loop, council
- Autonomous **studio_scout** + autonomy modes; `full` auto-creates tasks; security/deps collectors
- Default **$5 session budget** (soft until confirmed; disable with `0` / `/budget off` / `disable_budget`)
- Over-budget: block non-allowlisted tools + force free/local routing (LLM turn abort still deferred — see Next)
- First-run **`studio_setup action=onboard`** (local detect, prefer_local, budget, verify card)
- Local model preference (connected Ollama / LM Studio / local — no hardcoded model ids)
- Optional semantic recall (`set_semantic_recall`; sqlite-vec when present, else FTS overlap)
- Local OpenAI-compatible sidecar recipe (README + doctor Ollama probe)
- **CI triage** (`studio_ci action=triage`) — failed logs + root cause + `[ci:…]` tasks
- Remote exec policy (destructive blocklist, optional host/prefix allowlists, confirm when autonomy=full)
- Remote SSH sync + tunnel watchdog + `studio_remote`
- TUI dashboard, passive context, plan drift, constitution, browser verify

---

## Next (deferred)

| Priority | Item | Why |
|----------|------|-----|
| P1 | OpenCode **plugin API v2** migration | Wait until V2 is stable/out — transforms + client hooks may unlock harder budget stops |
| P2 | True OS-thread WASM workers for parse | Promise pool ships first; revisit if monorepo index still bottlenecks |
| P2 | Hard stop of LLM turns when over budget | Needs OpenCode hook that can abort generation; tool block + free routing is current best |

Docs pointer: [docs/roadmap-notes.md](docs/roadmap-notes.md).

---

## Non-goals

- Replacing personal chief-of-staff platforms (see Skynet — different product)
- Requiring cloud embedding APIs
- Dual JSON/SQLite storage paths
