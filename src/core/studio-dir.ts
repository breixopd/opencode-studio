import { existsSync, mkdirSync } from "fs"
import { join } from "path"
import { loadConfig } from "../config/config"
import { ensureStudioGitignored } from "./gitignore"

export function studioRoot(cwd = process.cwd()): string {
  return join(cwd, ".studio")
}

function applyGitignorePolicy(cwd: string): void {
  const config = loadConfig()
  const name = Object.entries(config.projects).find(
    ([, p]) => cwd === p.local || cwd.startsWith(p.local + "/"),
  )?.[0]
  const allowCommit = name ? Boolean(config.projects[name]?.commitStudio) : false
  ensureStudioGitignored(cwd, allowCommit)
}

export function ensureStudioDirs(cwd = process.cwd()): string {
  const root = studioRoot(cwd)
  const cache = join(root, "cache")
  if (!existsSync(cache)) mkdirSync(cache, { recursive: true })
  applyGitignorePolicy(cwd)
  return root
}

export function studioPath(...parts: string[]): string {
  const root = ensureStudioDirs()
  return join(root, ...parts)
}
