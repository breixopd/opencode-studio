# OpenCode Studio — Roadmap

> North star: **the only plugin a developer needs to ditch Cursor / Claude Code / Cline setups.**
> Native first, keyless by default, token-cheap, fast on big repos, smart enough for small models.

Shipped baseline = **v1.0.0-alpha** (first public alpha of the SQLite rewrite). This doc is forward-looking only — no historical audit dumps.

---

## Guiding principles

1. **Native first** — no third-party indexers, no embedding APIs by default
2. **Keyless by default** — DuckDuckGo + local AST + ripgrep; optional `TAVILY_API_KEY`
3. **Token-cheap** — ranges not whole files; stable system prompts for cache hits
4. **Resource-light** — lazy WASM, WAL SQLite, mtime incremental index
5. **Smart for small models** — structure via index so Haiku/Flash/Qwen-4B can work
6. **Autonomous by default** — scout improvements unless the user opts out
7. **Verify-first** — tests + `studio_verify` before handoff; grind + self-heal on failure

---

## Shipped (alpha)

- Unified SQLite store (`.studio/studio.db`): code index + workspace + cost ledger + diagnostics
- Graph queries: refs / importers / impact / hotspots
- SDLC team + `/start-work` fan-out, verify gate, grind loop, council
- Autonomous **studio_scout** + autonomy modes (`full` | `suggest` | `off`)
- Local model preference for cheap/read-only subagents (Ollama / LM Studio / local)
- Remote SSH sync + tunnel watchdog + `studio_remote`
- TUI dashboard, passive context, plan drift, CI watcher, constitution, browser verify

---

## Next (post-alpha)

| Priority | Item | Why |
|----------|------|-----|
| P0 | Stronger auto-act on high scout findings when `autonomy=full` (spawn implement→verify) | Closes the “agents wait to be asked” gap |
| P0 | Hard spend caps / session budget kill-switch | #1 competitor complaint (runaway token burn) |
| P1 | Worker-pool tree-sitter parse for 10k+ file repos | Perf on monorepos |
| P1 | Optional sqlite-vec semantic recall (off by default) | Better memory without cloud embeddings |
| P1 | Deeper CI triage agent on Actions failure | Bugbot-class local alternative |
| P2 | Cross-repo dependency graph for monorepos | Blast-radius queries |
| P2 | Cactus / edge OpenAI-compatible sidecar recipe in docs | Ultra-cheap tool routers on tiny hardware |

---

## Non-goals

- Replacing personal chief-of-staff platforms (see Skynet — different product)
- Requiring cloud embedding APIs
- Dual JSON/SQLite storage paths
