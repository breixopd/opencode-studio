/**
 * Tool catalog — single source of truth for all studio tool metadata.
 *
 * When you add a new tool, you only update THIS file. Everything else
 * (discipline prompt, help system, tool registration) derives from it.
 *
 * The catalog drives:
 *   - src/core/discipline.ts → dynamically generated SDLC phase + tool list
 *   - src/tools/help.ts → dynamically generated "tools" topic
 *   - src/index.ts → verifies all catalog tools are registered
 */

export type ToolCategory =
  | "Code"
  | "Git"
  | "Web"
  | "SDLC"
  | "Memory"
  | "Config"
  | "Remote"
  | "Cost"
  | "Health"

/** SDLC phase number (1-11) or null for cross-cutting tools. */
export type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | null

export interface ToolMeta {
  /** Tool name as registered: studio_xxx */
  name: string
  category: ToolCategory
  /** Token-cheap description (≤20 words) */
  description: string
  /** Which SDLC phase this tool belongs to (null = cross-cutting) */
  phase: Phase
  /** When to prefer this tool over alternatives (optional, for disambiguation) */
  whenToUse?: string
}

export const TOOL_CATALOG: ToolMeta[] = [
  // ——— Code ————————————————
  { name: "studio_index", category: "Code", phase: 1, description: "Unified code intelligence: search, semantic, similar, research, symbols, refs, importers, impact, hotspots, monorepo", whenToUse: "for any code query — BM25 + AST graph, not just text search" },
  { name: "studio_refactor", category: "Code", phase: 9, description: "Refactor planning: rename analysis, extract, callers, dead code, structure", whenToUse: "before renaming or extracting — shows all affected refs" },
  { name: "studio_grep", category: "Code", phase: 1, description: "Ripgrep search (instant, needs rg on PATH)", whenToUse: "for quick text search before building index" },
  { name: "studio_glob", category: "Code", phase: 1, description: "Find files by pattern (e.g. **/*.ts)", whenToUse: "to find files, not code content" },
  { name: "studio_symbols", category: "Code", phase: 1, description: "AST symbol index — search/file/outline/stats/rebuild", whenToUse: "for symbol-level navigation, not full-text search" },
  { name: "studio_code_search", category: "Code", phase: 2, description: "Public GitHub code search (not local workspace)", whenToUse: "to find how others implement a pattern publicly" },

  // ——— Git ————————————————
  { name: "studio_git", category: "Git", phase: 10, description: "Git management: status, diff, log, blame, commit (auto-message), stash, branch, restore/rollback", whenToUse: "for any git operation — parsed output, not raw" },

  // ——— Web ————————————————
  { name: "studio_search", category: "Web", phase: 2, description: "Web search (DuckDuckGo keyless, Tavily if key) with scraping", whenToUse: "to research APIs, docs, solutions" },
  { name: "studio_fetch", category: "Web", phase: 2, description: "URL → markdown readability extraction (SSRF-safe)", whenToUse: "to read a specific URL" },
  { name: "studio_crawl", category: "Web", phase: 2, description: "Bounded same-origin web crawl with per-page extraction", whenToUse: "to gather multi-page docs" },

  // ——— SDLC ————————————————
  { name: "studio_spec", category: "SDLC", phase: 3, description: "Generate structured spec from a goal — requirements, acceptance criteria, task breakdown", whenToUse: "before planning non-trivial features — ensures requirements-driven work" },
  { name: "studio_plan", category: "SDLC", phase: 4, description: "Create, read, list, activate, revise SDLC plans. Auto-exports to .studio/plans/<id>.md", whenToUse: "to structure implementation before coding" },
  { name: "studio_task", category: "SDLC", phase: 7, description: "Task board: list, create, start, done, block tasks with acceptance criteria", whenToUse: "to track atomic work units with acceptance criteria" },
  { name: "studio_verify", category: "SDLC", phase: 10, description: "Run test/lint/typecheck/build (auto-detects language). Snapshot/rollback for self-healing", whenToUse: "before handoff — or only=snapshot before implement" },
  { name: "studio_handoff", category: "SDLC", phase: 11, description: "Structured handoff summary. Gated by verify pass + tasks done", whenToUse: "to end a session or hand off to next agent" },
  { name: "studio_branch", category: "SDLC", phase: 7, description: "Context folding + git worktree isolation (open/fold/list/worktree_create/merge/remove)", whenToUse: "for sub-goal tracking or parallel agent isolation via real git worktrees" },

  // ——— Deps ————————————————
  { name: "studio_deps", category: "Code", phase: 6, description: "Dependency scanning: list, audit (OSV.dev keyless), outdated (npm/crates/PyPI)", whenToUse: "for security audit or update checking" },

  // ——— Memory ————————————————
  { name: "studio_brief", category: "Memory", phase: null, description: "Project identity/stack/conventions persisted in ~/.config/opencode-studio/", whenToUse: "to set or review project context" },
  { name: "studio_remember", category: "Memory", phase: null, description: "Persist rules + agent-driven auto-memory. scope=project/global. action=memory saves learnings to topic files", whenToUse: "when the agent learns something worth remembering — saves to topic files loaded on demand" },
  { name: "studio_memory", category: "Memory", phase: null, description: "Search plans, handoffs, folded branches", whenToUse: "to find prior decisions or context" },
  { name: "studio_context", category: "Memory", phase: null, description: "Pin/unpin context blocks that survive compaction", whenToUse: "to keep critical info across compaction" },
  { name: "studio_retrieve", category: "Memory", phase: null, description: "Fetch full output previously compressed by compress hook", whenToUse: "when you see 'studio_retrieve id=...' in compressed output" },

  // ——— Config ————————————————
  { name: "studio_preferences", category: "Config", phase: null, description: "Model mode, autonomy, local models, semantic recall, remote path, multi-remote env, remote exec policy, .studio commit", whenToUse: "to change routing mode, autonomy, or remote config" },
  { name: "studio_models", category: "Config", phase: null, description: "Sync providers, refresh Zen catalog, infer tiers", whenToUse: "when providers change or to check routing" },
  { name: "studio_setup", category: "Config", phase: null, description: "First-run onboard + SSH host bind (action=status|ssh|onboard)", whenToUse: "on first run: onboard for $5 budget/local; host to bind SSH" },
  { name: "studio_add_project", category: "Config", phase: null, description: "Add local→remote sync mapping", whenToUse: "to add a project mapping" },
  { name: "studio_remove_project", category: "Config", phase: null, description: "Remove a project mapping", whenToUse: "to remove a project mapping" },
  { name: "studio_list_projects", category: "Config", phase: null, description: "List all configured projects", whenToUse: "to see configured projects" },

  // ——— Remote ————————————————
  { name: "studio_remote", category: "Remote", phase: null, description: "SSH exec on remote host (blocklist + optional allowlists)", whenToUse: "to run commands on a remote box (DB, GPU)" },
  { name: "studio_sync_start", category: "Remote", phase: null, description: "Start real-time SSH file sync", whenToUse: "to start syncing files to remote" },
  { name: "studio_sync_stop", category: "Remote", phase: null, description: "Stop file sync", whenToUse: "to stop syncing" },
  { name: "studio_tunnel_status", category: "Remote", phase: null, description: "Check SSH tunnel status", whenToUse: "to check tunnel health" },
  { name: "studio_tunnel_restart", category: "Remote", phase: null, description: "Restart SSH tunnel", whenToUse: "when tunnel is down" },
  { name: "studio_status", category: "Remote", phase: null, description: "Runtime snapshot: projects, tunnel, sync state", whenToUse: "for overall system status" },

  // ——— Cost ————————————————
  { name: "studio_cost", category: "Cost", phase: null, description: "Per-session and all-time token usage + $ breakdown by model and agent", whenToUse: "to check spending" },

  // ——— Health ————————————————
  { name: "studio_doctor", category: "Health", phase: null, description: "Health check: config, SSH, tunnel, sync, ripgrep, code index, semantic recall, Ollama, models", whenToUse: "when something seems broken" },
  { name: "studio_report", category: "Health", phase: null, description: "One-shot JSON smoke-test bundle", whenToUse: "for debugging or diagnostics" },
  { name: "studio_help", category: "Health", phase: null, description: "Topic-based help for all studio features", whenToUse: "when you need to know what's available" },

  // ——— Standards & CI ————————————————
  { name: "studio_constitution", category: "Code", phase: 3, description: "Generate coding standards from project analysis — linters, formatters, ecosystem rules", whenToUse: "to create a project constitution that's auto-injected into session context" },
  { name: "studio_ci", category: "Health", phase: null, description: "GitHub Actions CI watcher — status, triage failing runs (logs + root cause + [ci:runId] tasks), start/stop background monitoring (30s)", whenToUse: "to check CI, triage failures with root-cause extraction, or monitor in background" },

  // ——— Agents ————————————————
  { name: "studio_agent", category: "Config", phase: null, description: "Manage agent profiles — list, sync (regenerate from catalog), create custom, remove", whenToUse: "to create custom subagents or regenerate studio agent profiles" },

  // ——— Advanced ————————————————
  { name: "studio_council", category: "Code", phase: 8, description: "Model Council: multi-lens ensemble review (security, architecture, correctness, maintainability)", whenToUse: "for complex/security-sensitive changes when you want deep multi-perspective review" },
  { name: "studio_browser", category: "Code", phase: 10, description: "Browser verification — checks if web app loads, pages respond. Uses system Chrome headlessly (zero deps)", whenToUse: "for web projects to verify pages load after changes" },
  { name: "studio_scout", category: "SDLC", phase: 9, description: "Autonomous improvement scout — verify failures, test gaps, security, deps, polish, research opportunities", whenToUse: "when idle, between tasks, or to find what to polish without the user asking" },
]

// ——— Derived data (auto-generated, never edit by hand) ————————————————

/** All tool names, derived from the catalog. */
export const ALL_TOOL_NAMES = TOOL_CATALOG.map((t) => t.name)

/** Tools grouped by category, derived. */
export function toolsByCategory(): Record<ToolCategory, ToolMeta[]> {
  const groups = {} as Record<ToolCategory, ToolMeta[]>
  for (const tool of TOOL_CATALOG) {
    if (!groups[tool.category]) groups[tool.category] = []
    groups[tool.category].push(tool)
  }
  return groups
}

/** Tools grouped by SDLC phase, derived. */
export function toolsByPhase(): Record<number, ToolMeta[]> {
  const groups: Record<number, ToolMeta[]> = {}
  for (const tool of TOOL_CATALOG) {
    if (tool.phase === null) continue
    if (!groups[tool.phase]) groups[tool.phase] = []
    groups[tool.phase].push(tool)
  }
  return groups
}

/** Cross-cutting tools (phase = null), derived. */
export function crossCuttingTools(): ToolMeta[] {
  return TOOL_CATALOG.filter((t) => t.phase === null)
}

/** Find a tool by name. */
export function findTool(name: string): ToolMeta | undefined {
  return TOOL_CATALOG.find((t) => t.name === name)
}

/**
 * Build the SDLC phase list with associated tools — dynamically generated.
 * When you add a tool with a phase, it automatically appears here.
 */
const PHASE_DESCRIPTIONS: Record<number, string> = {
  1: "Understand — read the codebase before making changes",
  2: "Research — gather external context (APIs, docs, patterns)",
  3: "Spec — generate structured requirements from the goal",
  4: "Plan — structure the implementation approach",
  5: "Architecture review — validate design decisions",
  6: "Security — check auth, data, APIs, deps, secrets",
  7: "Tasks + Implement — break into tasks and write code",
  8: "Review — check quality before handoff",
  9: "Refactor — improve structure, find dead code",
  10: "Verify — run tests, lint, typecheck, build",
  11: "Handoff — summarize work and update project profile",
}

export function phaseList(): string {
  const byPhase = toolsByPhase()
  const lines: string[] = []
  for (let phase = 1; phase <= 11; phase++) {
    const desc = PHASE_DESCRIPTIONS[phase] ?? `Phase ${phase}`
    const tools = byPhase[phase] ?? []
    const toolNames = tools.map((t) => t.name).join(", ")
    lines.push(`${phase}) ${desc}`)
    if (toolNames) lines.push(`   Tools: ${toolNames}`)
  }
  return lines.join("\n")
}

/** Build the categorized tool list for help output — dynamically generated. */
export function toolListText(): string {
  const groups = toolsByCategory()
  const lines: string[] = ["# All studio tools", ""]
  for (const category of Object.keys(groups) as ToolCategory[]) {
    const tools = groups[category]
    const names = tools.map((t) => t.name).join(", ")
    lines.push(`**${category}:** ${names}`)
  }
  return lines.join("\n")
}
