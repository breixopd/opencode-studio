# OpenCode Studio — Roadmap

> North star: **the only plugin a developer needs to ditch Cursor / Claude Code / Cline setups.**
> Native first, keyless by default, token-cheap, fast on big repos, smart enough for small models.

Shipped baseline = **v2.0.0-alpha** (first public alpha of the SQLite rewrite). This doc is forward-looking only.

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
- Graph queries: refs / importers / impact / hotspots
- SDLC team + `/start-work` fan-out, verify gate, grind loop, council
- Autonomous **studio_scout** + autonomy modes (`full` | `suggest` | `off`); `full` auto-creates tasks + mandates verify-first fixes
- Local model preference for cheap/read-only subagents (picks from connected Ollama / LM Studio / local models)
- Remote SSH sync + tunnel watchdog + `studio_remote`
- TUI dashboard, passive context, plan drift, CI watcher, constitution, browser verify

---

## Next (post-alpha)

| Priority | Item | Why |
|----------|------|-----|
| P0 | Hard spend caps / session budget kill-switch | ✅ shipped (`set_session_budget`) |
| P0 | Stronger auto-act on high scout findings when `autonomy=full` | ✅ shipped (creates `[scout:…]` tasks + mandatory implement→verify prompt) |
| P1 | Worker-pool tree-sitter parse for 10k+ file repos | Perf on monorepos |
| P1 | Optional sqlite-vec semantic recall (off by default) | Better memory without cloud embeddings |
| P1 | Deeper CI triage agent on Actions failure | Bugbot-class local alternative |
| P2 | Cross-repo dependency graph for monorepos | Blast-radius queries |
| P2 | Local OpenAI-compatible sidecar recipe in docs | Zero-cost read-only subagents on modest hardware |

---

## Non-goals

- Replacing personal chief-of-staff platforms (see Skynet — different product)
- Requiring cloud embedding APIs
- Dual JSON/SQLite storage paths
