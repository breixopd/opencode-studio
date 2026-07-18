import { existsSync, mkdirSync } from "fs"
import { join } from "path"
import { loadConfig } from "../config/config"
import { ensureStudioGitignored } from "./gitignore"
import { getActiveDirectory } from "./active-dir"

export function studioRoot(cwd = getActiveDirectory()): string {
  return join(cwd, ".studio")
}

// Memoize ensureStudioDirs — it's called ~13x per chat turn via ensureMigrated()
// but only needs to run once per process (dirs don't disappear mid-session).
const ensuredPaths = new Set<string>()

function applyGitignorePolicy(cwd: string): void {
  const config = loadConfig()
  const name = Object.entries(config.projects).find(
    ([, p]) => cwd === p.local || cwd.startsWith(p.local + "/"),
  )?.[0]
  const allowCommit = name ? Boolean(config.projects[name]?.commitStudio) : false
  ensureStudioGitignored(cwd, allowCommit)
}

export function ensureStudioDirs(cwd = getActiveDirectory()): string {
  if (ensuredPaths.has(cwd)) return studioRoot(cwd)

  const root = studioRoot(cwd)
  const cache = join(root, "cache")
  if (!existsSync(cache)) mkdirSync(cache, { recursive: true })
  applyGitignorePolicy(cwd)
  ensuredPaths.add(cwd)
  return root
}

export function studioPath(...parts: string[]): string {
  const root = ensureStudioDirs()
  return join(root, ...parts)
}
