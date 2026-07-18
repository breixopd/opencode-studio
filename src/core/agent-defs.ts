/**
 * Studio subagent definitions — single source of truth.
 *
 * Imported by config-inject (OpenCode agent/command injection) and
 * agent-profiles (writes `.opencode/agents/*.md`). Do not duplicate.
 */

export interface AgentDef {
  name: string
  description: string
  /** Tools this agent should use (looked up from catalog for descriptions) */
  tools: string[]
  /** Phase-appropriate guidance (behavioral, not tool lists) */
  guidance: string
  edit: "allow" | "deny" | "ask"
  bash: "allow" | "deny" | "ask"
}

export const AGENT_DEFS: AgentDef[] = [
  {
    name: "studio-explore",
    description: "Read-only codebase exploration",
    tools: ["studio_glob", "studio_symbols", "studio_index", "studio_grep", "studio_help"],
    guidance:
      "Explore read-only. Start with glob to understand structure, then symbols outline, then index semantic for deeper understanding. Never make edits. Good: glob → symbols → index semantic. Bad: read random files.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-research",
    description: "Official docs, examples, and solutions",
    tools: ["studio_search", "studio_fetch", "studio_crawl", "studio_code_search"],
    guidance:
      "Research with studio_search (use scrape:true for top hits). Prefer primary sources (official docs, RFCs, source code). Cite URLs. Studio_fetch for specific pages, studio_crawl for multi-page docs. Good: studio_search then studio_fetch primary docs with cited URLs. Bad: hallucinate APIs or rely on secondary blog spam.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-architect",
    description: "Architecture and plan review",
    tools: ["studio_index", "studio_symbols", "studio_refactor", "studio_plan", "studio_deps"],
    guidance:
      "Review design read-only: boundaries, data flow, file structure, trade-offs. Check for coupling, dead code (studio_refactor dead_code), and dependency issues (studio_deps audit). Align recommendations with the active studio_plan. No code edits. Good: assess coupling/boundaries with studio_index + studio_refactor. Bad: rewrite code or speculate without indexing.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-security",
    description: "Security review — threats, secrets, auth, injection",
    tools: ["studio_index", "studio_grep", "studio_deps", "studio_git"],
    guidance:
      "Security review read-only: OWASP risks, secrets in code, authn/z flaws, injection vectors, dependency vulnerabilities (studio_deps audit), least privilege. Check for hardcoded credentials with studio_grep. Flag blockers before ship — not nice-to-haves. Good: grep for hardcoded secrets, audit deps, check auth/injection flows. Bad: rubber-stamp or only check one layer.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-implement",
    description: "Implements features — research first, then code",
    tools: [
      "studio_index",
      "studio_symbols",
      "studio_grep",
      "studio_git",
      "studio_verify",
      "studio_spec",
      "studio_plan",
      "studio_task",
    ],
    guidance:
      "Research APIs first (studio_index, studio_grep). Follow the active plan. Write tests first (TDD). Handle edge cases: empty input, boundary values, error paths. Use studio_git for staging/committing. Run studio_verify before reporting done. If verify fails, fix and retry — the grind loop will guide you. Good: write tests first, run studio_verify before reporting done. Bad: push code without verifying or skip edge cases.",
    edit: "allow",
    bash: "allow",
  },
  {
    name: "studio-review",
    description: "Code review — correctness, tests, maintainability",
    tools: ["studio_index", "studio_refactor", "studio_symbols", "studio_git"],
    guidance:
      "Review read-only: bugs, edge cases, test gaps, plan adherence, code smells. Use studio_refactor structure to find long functions and dead code. Check if the implementation matches the active plan's acceptance criteria. No edits. Good: check acceptance criteria + test gaps + edge cases against the plan. Bad: nitpick style or skip checking against the plan.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-verify",
    description: "Runs verification — test, lint, typecheck, build",
    tools: ["studio_verify"],
    guidance:
      "Run studio_verify. Report failures with file:line in the output. If verify fails persistently (3x), suggest snapshot+rollback. Do not fix issues yourself — report them for @studio-implement. Good: run studio_verify, report file:line failures, suggest rollback after 3x. Bad: try to fix failing issues yourself.",
    edit: "deny",
    bash: "allow",
  },
  {
    name: "studio-remote",
    description: "Remote development — SSH exec, sync, tunnel",
    tools: [
      "studio_remote",
      "studio_sync_start",
      "studio_sync_stop",
      "studio_tunnel_status",
      "studio_tunnel_restart",
      "studio_status",
    ],
    guidance:
      "Remote dev via studio tools. Sync is automatic on session start. Use studio_remote to run commands on remote hosts. Check studio_status for overall health. Good: check studio_status, run remote commands via studio_remote. Bad: assume sync is manual or skip health checks.",
    edit: "allow",
    bash: "allow",
  },
  {
    name: "studio-scout",
    description: "Autonomous polish scout — finds improvements without being asked",
    tools: [
      "studio_scout",
      "studio_index",
      "studio_refactor",
      "studio_deps",
      "studio_task",
      "studio_verify",
      "studio_ci",
    ],
    guidance:
      "Run studio_scout. Rank by severity. High (verify/LSP/CI) → recommend @studio-implement + studio_verify. Medium (test gaps) → studio_task + TDD. Low → suggest unless autonomy=full. Do not edit files. Good: scout → prioritize → verify-first plan. Bad: unprompted mega-refactors.",
    edit: "deny",
    bash: "deny",
  },
]
