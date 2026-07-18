/**
 * Self-healing verify with auto-rollback.
 *
 * Before @studio-implement starts work, snapshot the current git HEAD and
 * persist it under `.studio/self-heal-snapshot.json`. If studio_verify fails
 * persistently (MAX_GRIND attempts), rollback restores THAT hash — never HEAD~1.
 *
 * This is a moat feature — Cursor/Claude Code have no such loop.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { getVerifyRetryHint } from "./workspace"
import { MAX_VERIFY_GRIND } from "../core/workspace"
import { gitExec as git } from "./git-exec"
import * as log from "./logger"

const MAX_GRIND = MAX_VERIFY_GRIND
const SNAPSHOT_FILE = "self-heal-snapshot.json"

export interface Snapshot {
  commitHash: string
  branch: string
  createdAt: string
  taskId: string | null
}

function snapshotPath(root: string): string {
  return join(root, ".studio", SNAPSHOT_FILE)
}

/** Persist snapshot under `.studio/` so rollback can restore the exact hash. */
export function saveSnapshot(root: string, snapshot: Snapshot): void {
  const path = snapshotPath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf-8")
}

/** Load the last persisted snapshot, or null if missing/invalid. */
export function loadSnapshot(root: string): Snapshot | null {
  const path = snapshotPath(root)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<Snapshot>
    if (!raw.commitHash || typeof raw.commitHash !== "string") return null
    return {
      commitHash: raw.commitHash,
      branch: typeof raw.branch === "string" ? raw.branch : "",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
      taskId: raw.taskId ?? null,
    }
  } catch (err) {
    log.debugCatch("src/core/self-heal.ts", err)
    return null
  }
}

/** Clear persisted snapshot after a successful rollback (or explicit discard). */
export function clearSnapshot(root: string): void {
  const path = snapshotPath(root)
  if (!existsSync(path)) return
  try {
    unlinkSync(path)
  } catch (err) {
    log.debugCatch("src/core/self-heal.ts", err)
  }
}

/** Snapshot current HEAD before starting implementation work. */
export async function snapshotHead(root: string, taskId: string | null = null): Promise<Snapshot | null> {
  try {
    const commitHash = await git(["rev-parse", "HEAD"], root)
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], root)
    const snapshot: Snapshot = {
      commitHash,
      branch,
      createdAt: new Date().toISOString(),
      taskId,
    }
    saveSnapshot(root, snapshot)
    log.info(`Snapshot: ${commitHash.slice(0, 8)} on ${branch}`)
    return snapshot
  } catch (err) {
    log.debugCatch("src/core/self-heal.ts", err)
    /* not a git repo or no commits yet */
    return null
  }
}

/** Restore files to the snapshot commit (soft — keeps working tree, reverts tracked changes). */
export async function rollbackToSnapshot(root: string, snapshot: Snapshot): Promise<string> {
  try {
    await git(["checkout", snapshot.commitHash, "--", "."], root)
    clearSnapshot(root)
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
      message: `Verify has failed ${grindCount}/${MAX_GRIND} times. Auto-rollback recommended — run studio_verify only=rollback to restore the persisted snapshot.`,
    }
  }

  return {
    shouldRollback: false,
    grindCount,
    maxGrind: MAX_GRIND,
    message:
      grindCount > 0
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
