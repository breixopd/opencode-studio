/**
 * Self-healing verify with auto-rollback.
 *
 * Before @studio-implement starts work, snapshot the current git HEAD.
 * If studio_verify fails persistently (MAX_GRIND attempts), auto-revert
 * to the snapshot and queue the failure for human review.
 *
 * This is a moat feature — Cursor/Claude Code have no such loop.
 */
import { spawn } from "child_process"
import { getVerifyRetryHint } from "./workspace"
import { MAX_VERIFY_GRIND } from "../hooks/compaction-continue"
import * as log from "./logger"

const MAX_GRIND = MAX_VERIFY_GRIND

/** Run a git command, returning trimmed stdout. */
function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, timeout: 10_000 })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`))
    })
  })
}

export interface Snapshot {
  commitHash: string
  branch: string
  createdAt: string
  taskId: string | null
}

/** Snapshot current HEAD before starting implementation work. */
export async function snapshotHead(root: string): Promise<Snapshot | null> {
  try {
    const commitHash = await git(["rev-parse", "HEAD"], root)
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], root)
    const snapshot: Snapshot = {
      commitHash,
      branch,
      createdAt: new Date().toISOString(),
      taskId: null,
    }
    log.info(`Snapshot: ${commitHash.slice(0, 8)} on ${branch}`)
    return snapshot
  } catch {
    /* not a git repo or no commits yet */
    return null
  }
}

/** Restore files to the snapshot commit (soft — keeps working tree, reverts tracked changes). */
export async function rollbackToSnapshot(root: string, snapshot: Snapshot): Promise<string> {
  try {
    await git(["checkout", snapshot.commitHash, "--", "."], root)
    log.info(`Rolled back to ${snapshot.commitHash.slice(0, 8)}`)
    return `✓ Reverted to snapshot ${snapshot.commitHash.slice(0, 8)} (${snapshot.branch}). Working tree restored.`
  } catch (err) {
    log.error(`Rollback failed: ${(err as Error).message}`)
    return `✗ Rollback failed: ${(err as Error).message}. Manual recovery: git checkout ${snapshot.commitHash}`
  }
}

/**
 * Check if the verify grind has exceeded the threshold for auto-rollback.
 * Returns a recommendation for the agent.
 */
export function checkGrindHealth(_root: string): {
  shouldRollback: boolean
  grindCount: number
  maxGrind: number
  message: string
} {
  const hint = getVerifyRetryHint()
  const grindCount = hint?.count ?? 0

  if (grindCount >= MAX_GRIND) {
    return {
      shouldRollback: true,
      grindCount,
      maxGrind: MAX_GRIND,
      message: `Verify has failed ${grindCount}/${MAX_GRIND} times. Auto-rollback recommended — run studio_git action=restore ref=<snapshot> to revert implementation work.`,
    }
  }

  return {
    shouldRollback: false,
    grindCount,
    maxGrind: MAX_GRIND,
    message: grindCount > 0
      ? `Verify retry ${grindCount}/${MAX_GRIND}. Fix and re-run studio_verify.`
      : "",
  }
}

/** Add a snapshot action to studio_verify's output when grind is high. */
export function grindContextBlock(root: string): string | null {
  const health = checkGrindHealth(root)
  if (health.grindCount === 0) return null
  return `[studio grind] ${health.grindCount}/${health.maxGrind} ${health.shouldRollback ? "— AUTO-ROLLBACK RECOMMENDED" : ""}. ${health.shouldRollback ? health.message : ""}`
}
