/**
 * Gitignore management — ensures studio-related files are NOT committed by default.
 *
 * Files that should NEVER be committed (user-local state):
 *   .studio/              — SQLite DB, cache, memory, plans, worktrees
 *   .opencode/agents/     — Generated agent profile files
 *
 * Files that users MAY commit (shared project context):
 *   AGENTS.md             — Team rules (user decides)
 *
 * The `commitStudio` preference only applies to `.studio/`.
 * Agent profiles are always gitignored (they're derived from the plugin,
 * not user-authored project context).
 */
import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import * as log from "./logger"

const GITIGNORE_ENTRIES = [
  ".studio/",
  ".opencode/agents/",
]

function gitignorePath(cwd: string): string {
  return join(cwd, ".gitignore")
}

function gitignoreHasEntry(content: string, entry: string): boolean {
  return content
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === entry || line === entry.replace(/\/$/, ""))
}

/**
 * Ensure studio-related files are gitignored (or not) based on user preference.
 * `allowCommit` only affects `.studio/` — agent profiles are always ignored.
 */
export function ensureStudioGitignored(cwd: string, allowCommit = false): "added" | "removed" | "unchanged" {
  const path = gitignorePath(cwd)
  let content = ""

  try {
    content = existsSync(path) ? readFileSync(path, "utf-8") : ""
  } catch {
    content = ""
  }

  let changed = false
  const entries = allowCommit
    ? GITIGNORE_ENTRIES.filter((e) => e !== ".studio/") // always keep agent profiles ignored
    : GITIGNORE_ENTRIES

  // Check if we need to add entries
  if (!allowCommit) {
    for (const entry of entries) {
      if (!gitignoreHasEntry(content, entry)) {
        const suffix = content.length === 0 || content.endsWith("\n") ? "" : "\n"
        content += `${suffix}${entry}\n`
        changed = true
      }
    }
  }

  // If user wants to commit .studio/, remove the .studio/ entry
  if (allowCommit) {
    const lines = content.split("\n")
    const filtered = lines.filter((line) => {
      const t = line.trim()
      return t !== ".studio" && t !== ".studio/" && t !== ".studio/**"
    })
    if (filtered.length !== lines.length) {
      content = filtered.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n$/, "") + "\n"
      changed = true
    }
  }

  if (changed) {
    writeFileSync(path, content, "utf-8")
    log.info(`Gitignore updated (${allowCommit ? "allowing" : "blocking"} .studio/ commit)`)
    return allowCommit ? "removed" : "added"
  }

  return "unchanged"
}
