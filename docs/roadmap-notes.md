# Roadmap notes

Product priorities live in **[ROADMAP.md](../ROADMAP.md)** at the repo root. This page only points at what is deferred vs already shipped for docs readers.

## Shipped baseline

**v2.0.0-alpha** — SQLite rewrite, SDLC agents, scout autonomy, session budget, local model preference, remote SSH sync/exec, CI triage, council, browser verify, and related alpha features listed in `ROADMAP.md`.

## Deferred (do not document as available)

| Priority | Item | Status |
|----------|------|--------|
| P1 | OpenCode **plugin API v2** migration | Wait until V2 is stable — may unlock harder budget stops via transforms / client hooks |
| P2 | Hard stop of LLM turns when over budget | Today: tool block + free/local routing. Needs a host hook that can abort generation |

OS-thread WASM parse workers (`ParsePool` / `STUDIO_PARSE_WORKERS`) shipped in alpha.7.

If a README or help topic implies mid-generation abort or “plugin V2-only” APIs, treat that as drift — current behavior is the alpha list in `ROADMAP.md`.

## Non-goals

See `ROADMAP.md`: no dual JSON/SQLite storage, no required cloud embedding APIs, no replacement of personal chief-of-staff products.
