/**
 * Active workspace directory from OpenCode plugin context.
 * Prefer this over process.cwd() so worktrees / multi-root stay correct.
 */
let activeDirectory: string | null = null

export function setActiveDirectory(dir: string | undefined | null): void {
  if (dir && dir.trim()) activeDirectory = dir.trim()
}

/** Clear override so getActiveDirectory() falls back to process.cwd(). */
export function clearActiveDirectory(): void {
  activeDirectory = null
}

export function getActiveDirectory(): string {
  return activeDirectory ?? process.cwd()
}
