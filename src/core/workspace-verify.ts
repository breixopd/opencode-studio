/** Workspace verify state — tracks verify pass/fail + grind count for self-healing. */
import { runQuery, queryOne } from "./studio-db"
import type { VerifyState, VerifyRetryHint, StudioPlan } from "./workspace-types"
import {
  db, ensureMigrated, now, joinLines,
  planFromRow, type PlanRow,
} from "./workspace-base"
import { getActivePlan, exportPlanMarkdown } from "./workspace-plans"

/** Maximum verify retry attempts before suggesting auto-rollback. */
export const MAX_VERIFY_GRIND = 3

export function recordVerifyFailure(command: string, output: string): StudioPlan | null {
  ensureMigrated()
  const d = db()
  const ts = now()
  // Atomic transaction wraps verify_state write AND plan revision.
  d.transaction(() => {
    const existing = queryOne<{ retry_count: number }>(
      d, "SELECT retry_count FROM verify_state WHERE id = 1",
    )
    const count = (existing?.retry_count ?? 0) + 1
    runQuery(
      d,
      `INSERT INTO verify_state (id, passed, at, commands, retry_count, last_failure)
       VALUES (1, 0, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET passed=0, at=excluded.at, retry_count=excluded.retry_count, last_failure=excluded.last_failure`,
      [ts, "", count, output.slice(0, 500)],
    )
    // Revise plan inside the same transaction.
    const active = queryOne<PlanRow>(d, "SELECT * FROM plans WHERE active = 1 LIMIT 1")
    if (active) {
      const revs = [...planFromRow(active).revisions, { at: ts, reason: `verify failed: ${command}`, note: output.slice(0, 1500) }]
      runQuery(d, "UPDATE plans SET revisions_json = ?, updated_at = ? WHERE id = ?", [
        JSON.stringify(revs), ts, active.id,
      ])
    }
  })()
  // Export plan markdown outside the transaction (best-effort).
  const active = getActivePlan()
  if (active) exportPlanMarkdown(active)
  return active
}

export function recordVerifySuccess(commands: string[]): void {
  ensureMigrated()
  const ts = now()
  runQuery(
    db(),
    `INSERT INTO verify_state (id, passed, at, commands, retry_count, last_failure)
     VALUES (1, 1, ?, ?, 0, '')
     ON CONFLICT(id) DO UPDATE SET passed=1, at=excluded.at, commands=excluded.commands, retry_count=0, last_failure=''`,
    [ts, joinLines(commands)],
  )
}

export function getVerifyState(): VerifyState | undefined {
  ensureMigrated()
  const row = queryOne<{ passed: number; at: string; commands: string }>(
    db(), "SELECT * FROM verify_state WHERE id = 1",
  )
  if (!row || !row.at) return undefined
  return { passed: row.passed === 1, at: row.at, commands: row.at ? row.commands.split("\n").filter((l) => l.length > 0) : [] }
}

export function getVerifyRetryHint(): VerifyRetryHint | undefined {
  ensureMigrated()
  const row = queryOne<{ retry_count: number; last_failure: string; at: string }>(
    db(), "SELECT retry_count, last_failure, at FROM verify_state WHERE id = 1",
  )
  if (!row || row.retry_count === 0) return undefined
  return { count: row.retry_count, lastFailure: row.last_failure, at: row.at }
}

export function canHandoff(force = false): { ok: boolean; reason?: string } {
  if (force) return { ok: true }
  const open = incompleteTasks()
  if (open.length) {
    return { ok: false, reason: `${open.length} open task(s) — studio_task done for each first` }
  }
  const verify = getVerifyState()
  if (!verify?.passed) {
    return { ok: false, reason: "studio_verify has not passed in this workspace — run it first" }
  }
  return { ok: true }
}

// Late import to avoid circular dependency at module init
import { incompleteTasks } from "./workspace-tasks"
