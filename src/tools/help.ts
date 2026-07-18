import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getModelMode, getPendingCatalogNotice } from "../core/project-profile"
import { toolListText } from "../core/tool-catalog"

const TOPICS: Record<string, string> = {
  get overview() {
    return `# OpenCode Studio

Zero-config dev platform plugin for OpenCode: remote sync, subagents, native code intelligence, and keyless web search.

**No API keys required** for core features. Optional: TAVILY_API_KEY (web search), SSH for remote sync.

**Quick start:** Add plugin to opencode.json → open a git repo → session auto-starts tunnel/sync → use \`/studio-start-work\` (or \`/start-work\`) or ask the agent.

**Budget / onboard:** \`/studio-budget\` · \`/budget\` · \`/studio-onboard\` · \`/onboard\`

${toolListText()}`
  },

  setup: `# Setup

1. **Plugin** — in ~/.config/opencode/opencode.json:
   \`\`\`json
   { "plugin": ["opencode-studio@alpha"] }
   \`\`\`
   (Until stable, use dist-tag \`alpha\`; npm \`latest\` may still be 1.x.)
2. **Build** — in plugin repo: \`bun run build\`, restart OpenCode.
3. **First-run** — \`studio_setup({ action: "onboard", budget_usd: 5 })\` or \`disable_budget: true\` for unlimited. Soft **$5** until you confirm. Say \"budget \$10\" / \"disable budget\", or \`/studio-budget\` / \`/budget\` / \`/studio-onboard\` / \`/onboard\`.
4. **SSH (optional)** — ~/.ssh/config with a Host entry; run \`studio_setup({ host: "<alias>" })\` to bind (nothing is auto-saved).
5. **Verify** — \`studio_doctor\` or \`/studio-smoke-test\`

**Optional env (never required):**
- \`TAVILY_API_KEY\` — better web search (falls back to DuckDuckGo)
`,

  code: `# Code intelligence (native, no 3rd party)

Use \`studio_help topic=tools\` for the full catalog. Core code tools:

- **studio_glob** — find files by pattern (\`**/*.ts\`)
- **studio_grep** — ripgrep search (needs \`rg\` on PATH)
- **studio_symbols** — AST symbol index — search/file/outline/stats/rebuild
- **studio_index** — unified: search, semantic, similar, research, symbols, **refs, importers, impact, hotspots, monorepo**

**Index:** SQLite FTS5 + tree-sitter AST → \`.studio/studio.db\` (WAL mode). Rebuild uses OS-thread WASM workers (\`STUDIO_PARSE_WORKERS=0\` to force inline).
**Graph queries** (Phase 2): refs=callers, importers=who-imports-file, impact=transitive callers, hotspots=most-referenced, monorepo=workspace packages + cross-package imports
**AST:** tree-sitter WASM — TS/JS/Python/Go/Rust/Java/Ruby/PHP/C/C++/C#/Swift/Kotlin/Lua/Zig/Elixir and more.

**Workflow for small models:** glob → symbols outline → index semantic → read specific files.`,

  search: `# Web search (keyless by default)

- **studio_search** — DuckDuckGo (no key) or Tavily if TAVILY_API_KEY set
- **studio_fetch** — URL → readable markdown (readability extraction)
- **studio_crawl** — bounded same-origin crawl
- **studio_code_search** — public GitHub (auth: GITHUB_TOKEN / GH_TOKEN / \`gh auth\` login)

**Tips:**
- \`studio_search scrape:true\` — fetches and extracts top 3 results
- For local code always use studio_grep / studio_index, not studio_code_search
- If code search returns 401: run \`gh auth login\` (same login CI triage uses)`,

  models: `# Model routing

Subagents get models automatically from your OpenCode picker + Zen catalog.

| Command | Purpose |
|---------|---------|
| studio_preferences set_model_mode free | Cheapest models everywhere |
| studio_preferences set_model_mode balanced | Default: cheap read-only, main model for implement |
| studio_preferences set_model_mode quality | Main model on all agents |
| studio_preferences set_prefer_local true | Route fast/read-only agents to Ollama/LM Studio/local |
| studio_preferences set_session_budget 5 | Set spend cap (\$); 0 or disable_budget disables |
| /studio-budget 5 · /budget off · /studio-onboard · /onboard | Quick set/disable budget or first-run wizard |
| studio_preferences set_semantic_recall true | Optional similar-chunk recall (sqlite-vec or FTS fallback) |
| studio_models show | Catalog + provider change detection |
| studio_models refresh_all | Re-sync after adding/removing providers |

**Local tip:** Start Ollama / LM Studio / llama.cpp with an OpenAI-compatible /v1 endpoint, add it as an OpenCode provider, then \`studio_preferences set_prefer_local true\`. Studio routes cheap/read-only agents to models you have loaded — no hardcoded local model list. See README "Local OpenAI-compatible sidecar".

**Local / cost saving:** Connect Ollama (or LM Studio / OpenAI-compatible local). Studio auto-routes to models you have loaded — no hardcoded local model list.

When providers change, studio prompts you to run \`studio_models refresh_all\`.`,

  workflow: `# SDLC workflow

**Primary slash commands** (\`studio-*\`, TUI-aligned): /studio-onboard, /studio-budget, /studio-help, /studio-start-work, /studio-deep-dive, /studio-research, /studio-architect, /studio-security, /studio-review, /studio-plan, /studio-verify, /studio-handoff, /studio-scout, /studio-council, /studio-council-plan, /studio-smoke-test, /studio-doctor, /studio-cost

**Short aliases:** /onboard, /budget, /help, /start-work, /deep-dive, /research, /architect, /security, /review, /plan, /verify, /handoff, /scout, /council, /council-plan, /smoke-test, /doctor, /cost

**Agents:** studio-explore, studio-research, studio-architect, studio-security, studio-implement, studio-review, studio-verify, studio-remote, studio-scout

**Autonomy (default=suggest):** Agents surface polish/test/research opportunities via studio_scout without being asked.
- \`studio_preferences set_autonomy full accept_risk:true\` — act on findings when idle (verify-first; requires risk accept)
- \`studio_preferences accept_autonomy_risk\` / say "I accept the risk" — acknowledge full-autonomy risks
- \`studio_preferences set_autonomy suggest\` — surface only (default)
- \`studio_preferences set_autonomy off\` — disable (or say "don't scout")
- \`studio_preferences clear_autonomy_risk\` / say "revoke autonomy risk" — revoke acknowledgment

**Gates:** studio_verify must pass before studio_handoff (unless force:true). TDD gate warns if no test file for the active task.

**Memory:** studio_brief, studio_remember, studio_memory, studio_context pin

**Cost:** studio_cost — per-session and all-time token usage + $ breakdown by model and agent. Budget: /studio-budget 5 · /budget off · studio_preferences set_session_budget.`,

  cost: `# Cost ledger

studio_cost captures token usage from every assistant message and attributes it to (session, agent, model, branch, task).

| Usage | Command |
|-------|---------|
| This session's total | studio_cost |
| All sessions, all-time | studio_cost this_session=false |
| Last 24h only | studio_cost since_hours=24 |
| Prune old data (30+ days) | studio_cost prune=true |

**How it works:** The \`message.updated\` event from opencode carries \`cost\`, \`tokens\` (input/output/reasoning/cache), \`modelID\`, \`providerID\`, \`sessionID\`, and \`path\`. Studio records each one to the \`cost_events\` table in studio.db (idempotent on message_id — dedupes re-emitted events).

**Branch-aware:** cost events are tagged with the current git branch, so you can see "how much did the auth feature branch cost".`,

  remote: `# Remote sync + remote exec

Auto-starts SSH tunnel + file sync on session.created. Tunnel has exponential-backoff watchdog (1s→2s→4s→…→5min cap). After 3 consecutive failures, discipline injects a "tunnel down" notice.

| Tool | Purpose |
|------|---------|
| studio_setup | First-run onboard (budget/local) + SSH host bind |
| studio_status | Projects, tunnel, sync state |
| studio_tunnel_status / restart | Tunnel control |
| studio_sync_start / stop | Manual sync |
| studio_remote | SSH exec on remote host (run tests/verify on remote box) |
| studio_preferences set_remote_path | Per-project remote path |
| studio_preferences add_remote_env | Add multi-remote env (dev/staging) |
| studio_preferences set_remote_env | Switch active remote env |
| studio_preferences set_remote_policy | Restrict studio_remote hosts + command prefixes |

**studio_remote safety:**
- Always blocks destructive patterns: \`rm -rf\`, \`dd \`, \`mkfs\`, \`shutdown\`, \`reboot\`, \`> /dev/\`
- Optional \`config.remote.allowedHosts\` / \`allowedCommandPrefixes\` — set via \`studio_preferences set_remote_policy\`
- When allowlists are empty and autonomy=full: user risk accept OR \`confirm:true\` (agent-supplied, not host HITL); always warns

Tunnel defaults: local 8443 → remote 8443 (generic TCP forward for remote services).`,

  get tools() { return `${toolListText()}

**Smart automation (zero-config):**
- Auto-detects project type (21+ ecosystems) and configures verify commands
- Auto-detects formatter/linter and injects conventions into session context
- LSP diagnostics captured in real-time — agent knows about type errors
- file.edited → debounced incremental reindex (no full rebuild)
- session.idle → prune old cost/diagnostics, WAL checkpoint
- Cross-session resume card + pre-flight cost preview auto-injected
- Self-healing verify: snapshot HEAD, auto-rollback on persistent failure
- Autonomous scout (studio_scout): polish/test/research opportunities without being asked
- Autonomy opt-out: studio_preferences set_autonomy off (or say "don't scout")` },

  troubleshooting: `# Troubleshooting

| Issue | Fix |
|-------|-----|
| studio_grep fails | Install ripgrep: \`rg --version\` |
| Slow first search | Index builds in background; studio_symbols action=rebuild |
| Provider routing wrong | studio_models refresh_all |
| Handoff blocked | Run studio_verify first |
| Web search empty | DDG layout may change; set TAVILY_API_KEY optional |
| Tunnel down | studio_tunnel_restart; check ~/.ssh/config |

Run \`studio_report\` and paste JSON when debugging.`,

  roadmap: `# Studio roadmap — alpha status

**Shipped:** SQLite FTS5 + graph, token budgets, cost ledger, remote/tunnel, SDLC agents,
verify gate + grind, scout autonomy, local model preference, semantic recall (optional),
council, CI triage/watcher, constitution, browser verify, TUI, session spend caps,
local OpenAI-compatible sidecar recipe.

See \`ROADMAP.md\` / \`docs/roadmap-notes.md\` for deferred items (OpenCode plugin API v2,
OS-thread WASM parse workers, hard LLM turn abort when over budget).`,
}

export function helpText(topic?: string): string {
  if (!topic || topic === "all") {
    const keys = Object.keys(TOPICS)
    const notice = getPendingCatalogNotice()
    const lines = [
      "# studio_help topics",
      "",
      keys.map((k) => `- **${k}**`).join("\n"),
      "",
      "Usage: studio_help topic=code",
      `Model mode: ${getModelMode()}`,
    ]
    if (notice) lines.push(`\n⚠ ${notice}`)
    return lines.join("\n")
  }
  const key = topic.toLowerCase().replace(/\s+/g, "-")
  if (TOPICS[key]) return TOPICS[key]
  const fuzzy = Object.keys(TOPICS).find((k) => k.includes(key) || key.includes(k))
  if (fuzzy) return TOPICS[fuzzy]
  return `Unknown topic '${topic}'. Topics: ${Object.keys(TOPICS).join(", ")}`
}

export const studio_help: ToolDefinition = tool({
  description:
    "Studio help: setup, code intelligence, search, models, workflow, remote sync, cost ledger, troubleshooting. No API keys needed for core use.",
  args: {
    topic: tool.schema
      .string()
      .optional()
      .describe(
        "overview | setup | code | search | models | workflow | cost | remote | tools | roadmap | troubleshooting | all",
      ),
  },
  async execute(args) {
    return helpText(args.topic)
  },
})
