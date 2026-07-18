/**
 * Dynamic agent profile generator — writes agent markdown files to
 * `.opencode/agents/` so OpenCode's built-in agent system picks them up.
 *
 * This makes the plugin self-configuring: the AGENT_DEFS from config-inject.ts
 * are written as files that OpenCode reads natively, so agents work even
 * without the config hook running (e.g. in IDE mode, web mode, etc.).
 *
 * Also supports USER-DEFINED custom agents: the user can create their own
 * agent preferences (e.g. "I always want a frontend reviewer") and we
 * generate the agent file from those preferences + the tool catalog.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { findTool } from "./tool-catalog"
import * as log from "./logger"

const AGENTS_DIR = ".opencode/agents"

export interface CustomAgentDef {
  name: string
  description: string
  prompt: string
  tools: string[]
  edit: "allow" | "deny" | "ask"
  bash: "allow" | "deny" | "ask"
  model?: string
  temperature?: number
}

/** Standard studio agents — derived from AGENT_DEFS. */
function studioAgentDefs(): CustomAgentDef[] {
  return [
    {
      name: "studio-explore",
      description: "Read-only codebase exploration",
      prompt: "Explore read-only. Start with glob to understand structure, then symbols outline, then index semantic for deeper understanding. Never make edits. Good: glob → symbols → index semantic. Bad: read random files.",
      tools: ["studio_glob", "studio_symbols", "studio_index", "studio_grep", "studio_help"],
      edit: "deny",
      bash: "deny",
    },
    {
      name: "studio-research",
      description: "Official docs, examples, and solutions",
      prompt: "Research with studio_search (use scrape:true for top hits). Prefer primary sources (official docs, RFCs, source code). Cite URLs. Good: studio_search then studio_fetch primary docs with cited URLs. Bad: hallucinate APIs or rely on secondary blog spam.",
      tools: ["studio_search", "studio_fetch", "studio_crawl", "studio_code_search"],
      edit: "deny",
      bash: "deny",
    },
    {
      name: "studio-architect",
      description: "Architecture and plan review",
      prompt: "Review design read-only: boundaries, data flow, file structure, trade-offs. Check for coupling, dead code (studio_refactor dead_code), and dependency issues (studio_deps audit). Align recommendations with the active studio_plan. No code edits. Good: assess coupling/boundaries with studio_index + studio_refactor. Bad: rewrite code or speculate without indexing.",
      tools: ["studio_index", "studio_symbols", "studio_refactor", "studio_plan", "studio_deps"],
      edit: "deny",
      bash: "deny",
    },
    {
      name: "studio-security",
      description: "Security review — threats, secrets, auth, injection",
      prompt: "Security review read-only: OWASP risks, secrets in code, authn/z flaws, injection vectors, dependency vulnerabilities (studio_deps audit), least privilege. Check for hardcoded credentials with studio_grep. Flag blockers before ship. Good: grep for hardcoded secrets, audit deps, check auth/injection flows. Bad: rubber-stamp or only check one layer.",
      tools: ["studio_index", "studio_grep", "studio_deps", "studio_git"],
      edit: "deny",
      bash: "deny",
    },
    {
      name: "studio-implement",
      description: "Implements features — research first, then code",
      prompt: "Research APIs first (studio_index, studio_grep). Follow the active plan. Write tests first (TDD). Handle edge cases: empty input, boundary values, error paths. Use studio_git for staging/committing. Run studio_verify before reporting done. Good: write tests first, run studio_verify before reporting done. Bad: push code without verifying or skip edge cases.",
      tools: ["studio_index", "studio_symbols", "studio_grep", "studio_git", "studio_verify", "studio_spec", "studio_plan", "studio_task"],
      edit: "allow",
      bash: "allow",
    },
    {
      name: "studio-review",
      description: "Code review — correctness, tests, maintainability",
      prompt: "Review read-only: bugs, edge cases, test gaps, plan adherence, code smells. Use studio_refactor structure to find long functions and dead code. Check if the implementation matches the active plan's acceptance criteria. No edits. Good: check acceptance criteria + test gaps + edge cases against the plan. Bad: nitpick style or skip checking against the plan.",
      tools: ["studio_index", "studio_refactor", "studio_symbols", "studio_git"],
      edit: "deny",
      bash: "deny",
    },
    {
      name: "studio-verify",
      description: "Runs verification — test, lint, typecheck, build",
      prompt: "Run studio_verify. Report failures with file:line in the output. If verify fails persistently (3x), suggest snapshot+rollback. Do not fix issues yourself. Good: run studio_verify, report file:line failures, suggest rollback after 3x. Bad: try to fix failing issues yourself.",
      tools: ["studio_verify"],
      edit: "deny",
      bash: "allow",
    },
    {
      name: "studio-remote",
      description: "Remote development — SSH exec, sync, tunnel",
      prompt: "Remote dev via studio tools. Sync is automatic on session start. Use studio_remote to run commands on remote hosts. Check studio_status for overall health. Good: check studio_status, run remote commands via studio_remote. Bad: assume sync is manual or skip health checks.",
      tools: ["studio_remote", "studio_sync_start", "studio_sync_stop", "studio_tunnel_status", "studio_tunnel_restart", "studio_status"],
      edit: "allow",
      bash: "allow",
    },
    {
      name: "studio-scout",
      description: "Autonomous polish scout — finds improvements without being asked",
      prompt: "Run studio_scout. Rank findings by severity. For high (verify/LSP/CI): recommend immediate fix via @studio-implement + studio_verify. For medium (test gaps): create studio_task and outline TDD steps. For low (polish/hotspots): suggest only unless autonomy=full. Never edit files yourself — report actionable next steps. Good: scout → prioritize → verify-first plan. Bad: refactor everything unprompted or ignore verify failures.",
      tools: ["studio_scout", "studio_index", "studio_refactor", "studio_deps", "studio_task", "studio_verify", "studio_ci"],
      edit: "deny",
      bash: "deny",
    },
  ]
}

/** Build the markdown content for an agent file. */
function buildAgentMarkdown(def: CustomAgentDef): string {
  // Build tool hints from the catalog (dynamically derived)
  const toolHints = def.tools
    .map((name) => {
      const tool = findTool(name)
      return tool ? `- ${name}: ${tool.description}` : `- ${name}`
    })
    .join("\n")

  // Build the frontmatter
  const frontmatter: string[] = [
    "---",
    `description: ${def.description}`,
    `mode: subagent`,
  ]
  if (def.model) frontmatter.push(`model: ${def.model}`)
  if (def.temperature !== undefined) frontmatter.push(`temperature: ${def.temperature}`)
  frontmatter.push("permission:")
  frontmatter.push(`  edit: ${def.edit}`)
  frontmatter.push(`  bash: ${def.bash}`)
  frontmatter.push("---")

  // Build the full markdown
  return [
    ...frontmatter,
    "",
    def.prompt,
    "",
    "## Available Tools",
    "",
    toolHints,
  ].join("\n")
}

/** Generate all agent files to .opencode/agents/. Overwrites studio-* files only. */
export function syncAgentProfiles(root: string): number {
  const agentsDir = join(root, AGENTS_DIR)
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true })

  const defs = studioAgentDefs()
  let written = 0

  for (const def of defs) {
    const path = join(agentsDir, `${def.name}.md`)
    const content = buildAgentMarkdown(def)
    try {
      const existing = existsSync(path) ? readFileSync(path, "utf-8") : ""
      if (existing !== content) {
        writeFileSync(path, content, "utf-8")
        written++
      }
    } catch (err) {
      log.debugCatch("src/core/agent-profiles.ts", err);
      /* best-effort */
    }
  }

  if (written > 0) log.info(`Synced ${written} agent profiles to .opencode/agents/`)
  return written
}

/** Save a user-defined custom agent. */
export function saveCustomAgent(root: string, def: CustomAgentDef): string {
  const agentsDir = join(root, AGENTS_DIR)
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true })

  const path = join(agentsDir, `${def.name}.md`)
  writeFileSync(path, buildAgentMarkdown(def), "utf-8")
  log.info(`Custom agent saved: ${def.name} → ${path}`)
  return path
}

/** List all agent files (both studio and custom). */
export function listAgentProfiles(root: string): Array<{ name: string; path: string; isStudio: boolean }> {
  const agentsDir = join(root, AGENTS_DIR)
  if (!existsSync(agentsDir)) return []
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"))
  return files.map((f) => ({
    name: f.replace(/\.md$/, ""),
    path: join(agentsDir, f),
    isStudio: f.startsWith("studio-"),
  }))
}

/** Remove a custom agent (won't remove studio-* agents). */
export function removeCustomAgent(root: string, name: string): boolean {
  if (name.startsWith("studio-")) {
    throw new Error("Cannot remove built-in studio agents")
  }
  const path = join(root, AGENTS_DIR, `${name}.md`)
  if (!existsSync(path)) return false
  rmSync(path)
  log.info(`Custom agent removed: ${name}`)
  return true
}
