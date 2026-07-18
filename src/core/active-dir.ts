/**
 * Active workspace directory from OpenCode plugin context.
 * Prefer this over process.cwd() so worktrees / multi-root stay correct.
 */
let activeDirectory: string | null = null

export function setActiveDirectory(dir: string | undefined | null): void {
  if (dir && dir.trim()) activeDirectory = dir.trim()
}

export function getActiveDirectory(): string {
  return activeDirectory ?? process.cwd()
}
