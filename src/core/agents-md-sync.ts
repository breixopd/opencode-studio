import * as log from "./logger"
/**
 * AGENTS.md sync — keeps OpenCode's built-in instruction file in sync
 * with studio rules, so ALL agents (not just studio agents) see them.
 *
 * OpenCode reads AGENTS.md from the project root and injects it into
 * the context of every agent. By syncing our studio rules there,
 * we ensure rules are visible even to agents that don't go through
 * our discipline hook (e.g. the main "build" agent, "general" agent).
 *
 * The sync is one-way: studio rules → AGENTS.md (append section).
 * User's own AGENTS.md content is preserved — we only manage our section.
 */
import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { listRules } from "./workspace"
import { loadUserProfile } from "./project-profile"

const STUDIO_SECTION_START = "<!-- studio-rules-start -->"
const STUDIO_SECTION_END = "<!-- studio-rules-end -->"

/** Sync studio rules into AGENTS.md. Idempotent — safe to call on every session start. */
export function syncRulesToAgentsMd(root: string): boolean {
  const agentsPath = join(root, "AGENTS.md")
  let content = ""

  try {
    content = existsSync(agentsPath) ? readFileSync(agentsPath, "utf-8") : ""
  } catch (err) {
      log.debugCatch("src/core/agents-md-sync.ts", err);
    content = ""
  }

  const projectRules = listRules()
  const globalRules = loadUserProfile().globalRules
  const allRules = [...projectRules, ...globalRules.map((r) => `[global] ${r}`)]

  // Build the studio section.
  let section: string
  if (allRules.length === 0) {
    section = ""
  } else {
    const lines = [
      STUDIO_SECTION_START,
      "",
      "## Studio Rules",
      "",
      "These rules are auto-synced from opencode-studio. Do not edit this section manually.",
      "Use `studio_remember add` or `studio_remember action=memory` instead.",
      "",
      ...allRules.map((r) => `- ${r}`),
      "",
      STUDIO_SECTION_END,
    ]
    section = lines.join("\n")
  }

  // Replace or remove the existing studio section.
  const startIdx = content.indexOf(STUDIO_SECTION_START)
  const endIdx = content.indexOf(STUDIO_SECTION_END)

  if (startIdx >= 0 && endIdx >= 0) {
    // Replace existing section.
    const before = content.slice(0, startIdx).trimEnd()
    const after = content.slice(endIdx + STUDIO_SECTION_END.length).trimStart()
    const parts: string[] = []
    if (before) parts.push(before)
    if (section) parts.push(section)
    if (after) parts.push(after)
    content = parts.join("\n\n")
  } else if (section) {
    // Append new section.
    content = content ? `${content.trimEnd()}\n\n${section}` : section
  }

  // Only write if content changed.
  const newContent = content || ""
  try {
    const existing = existsSync(agentsPath) ? readFileSync(agentsPath, "utf-8") : ""
    if (existing === newContent) return false
    writeFileSync(agentsPath, newContent, "utf-8")
    return true
  } catch (err) {
      log.debugCatch("src/core/agents-md-sync.ts", err);
    return false
  }
}
