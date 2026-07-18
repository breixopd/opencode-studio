/**
 * Dynamic agent profile generator — writes agent markdown files to
 * `.opencode/agents/` so OpenCode's built-in agent system picks them up.
 *
 * Agent defs come from `agent-defs.ts` (shared with config-inject).
 * Also supports USER-DEFINED custom agents.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "fs"
import { join, resolve, sep } from "path"
import { AGENT_DEFS } from "./agent-defs"
import { findTool } from "./tool-catalog"
import * as log from "./logger"

const AGENTS_DIR = ".opencode/agents"
const AGENT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

function assertSafeAgentName(name: string): string {
  if (!AGENT_NAME_RE.test(name)) {
    throw new Error(`Invalid agent name "${name}" — use letters, digits, _ or - only`)
  }
  return name
}

function agentFilePath(root: string, name: string): string {
  const safe = assertSafeAgentName(name)
  const agentsDir = resolve(root, AGENTS_DIR)
  const path = resolve(agentsDir, `${safe}.md`)
  if (!path.startsWith(agentsDir + sep) && path !== agentsDir) {
    throw new Error(`Agent path escapes agents dir: ${name}`)
  }
  return path
}

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

/** Standard studio agents — from shared AGENT_DEFS. */
function studioAgentDefs(): CustomAgentDef[] {
  return AGENT_DEFS.map((d) => ({
    name: d.name,
    description: d.description,
    prompt: d.guidance,
    tools: d.tools,
    edit: d.edit,
    bash: d.bash,
  }))
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
      log.debugCatch("src/core/agent-profiles.ts", err)
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

  const path = agentFilePath(root, def.name)
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
  const path = agentFilePath(root, name)
  if (!existsSync(path)) return false
  rmSync(path)
  log.info(`Custom agent removed: ${name}`)
  return true
}
