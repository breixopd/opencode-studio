import { execSync } from "child_process"
import { openStudioDb, queryOne, runQuery } from "./studio-db"

// Cache the branch name for 10 seconds — avoids spawning `git rev-parse` on
// every chat turn via the discipline hook. The cache is per-process.
const BRANCH_CACHE_MS = 10_000
const branchCache = new Map<string, { branch: string; at: number }>()

export function currentBranch(root = process.cwd()): string {
  const cached = branchCache.get(root)
  if (cached && Date.now() - cached.at < BRANCH_CACHE_MS) return cached.branch

  let branch = "detached"
  try {
    const out = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 1500,
    }).trim()
    if (out) branch = out
  } catch {
    /* git not available or not a repo */
  }
  branchCache.set(root, { branch, at: Date.now() })
  return branch
}

/** Invalidate the branch cache (call on file.edited or session.idle if needed). */
export function invalidateBranchCache(root = process.cwd()): void {
  branchCache.delete(root)
}

export function branchScopeKey(root = process.cwd()): string {
  return `${root}:${currentBranch(root)}`
}

/**
 * Check if the branch has changed since the last recorded scope.
 * Invalidates the cache to detect real git checkouts.
 * Returns the previous branch name if a switch happened, or null if no switch.
 */
export function detectBranchSwitch(root = process.cwd()): string | null {
  invalidateBranchCache(root)
  const now = currentBranch(root)
  const db = openStudioDb(root)
  const row = queryOne<{ value: string }>(
    db,
    "SELECT value FROM meta WHERE key = 'active_branch'",
  )
  const previous = row?.value ?? null
  if (previous === now) return null
  runQuery(
    db,
    "INSERT INTO meta(key, value) VALUES('active_branch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [now],
  )
  return previous
}

// Throttle branch switch detection — only check every 10s to avoid
// spawning git rev-parse on every chat turn via the discipline hook.
let lastBranchCheck = 0
const BRANCH_CHECK_INTERVAL_MS = 10_000

/** Inject a notice into discipline output when the agent should be aware of a switch. */
export function branchSwitchNotice(root = process.cwd()): string | null {
  // Throttle: skip if checked recently (the 10s branch cache covers us).
  const now = Date.now()
  if (now - lastBranchCheck < BRANCH_CHECK_INTERVAL_MS) return null
  lastBranchCheck = now

  const previous = detectBranchSwitch(root)
  if (previous === null) return null
  const current = currentBranch(root)
  if (previous === "detached" || current === "detached") return null
  return `[studio branch] switched ${previous} → ${current}. Re-scoping: rebuild code index if needed.`
}
