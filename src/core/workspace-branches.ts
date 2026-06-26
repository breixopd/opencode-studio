/** Workspace branches — in-workspace context-folding sub-goal branches. */
import { runQuery, queryOne, queryAll } from "./studio-db"
import type { StudioBranch } from "./workspace-types"
import {
  db, ensureMigrated, now, genId, currentBranchSafe,
  branchFromRow, type BranchRow, loadWorkspace,
} from "./workspace-base"

export function openBranch(title: string, goal: string): StudioBranch {
  ensureMigrated()
  const d = db()
  const ts = now()
  const branchId = genId()
  const ws = loadWorkspace()
  d.transaction(() => {
    runQuery(d, "UPDATE branches SET active = 0")
    runQuery(
      d,
      `INSERT INTO branches
       (id, title, goal, status, parent_branch_id, plan_id, git_branch, created_at, active)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, 1)`,
      [branchId, title.slice(0, 200), goal.slice(0, 1000), ws.activeBranchId ?? null, ws.activePlanId ?? null, currentBranchSafe(), ts],
    )
  })()
  return getActiveBranch()!
}

export function foldBranch(branchId: string, summary: string): StudioBranch {
  ensureMigrated()
  const d = db()
  const ws = loadWorkspace()
  const ts = now()
  d.transaction(() => {
    const result = runQuery(
      d,
      "UPDATE branches SET status = 'folded', summary = ?, folded_at = ? WHERE id = ?",
      [summary.slice(0, 5000), ts, branchId],
    )
    if (result.changes === 0) throw new Error(`Branch not found: ${branchId}`)
    if (ws.activeBranchId === branchId) {
      const parentRow = queryOne<{ parent_branch_id: string | null }>(
        d, "SELECT parent_branch_id FROM branches WHERE id = ?", [branchId],
      )
      const parent = parentRow?.parent_branch_id ?? null
      runQuery(d, "UPDATE branches SET active = 0")
      if (parent) runQuery(d, "UPDATE branches SET active = 1 WHERE id = ?", [parent])
    }
  })()
  const updated = queryOne<BranchRow>(d, "SELECT * FROM branches WHERE id = ?", [branchId])
  if (!updated) throw new Error(`Branch vanished: ${branchId}`)
  return branchFromRow(updated)
}

export function listBranches(): StudioBranch[] {
  ensureMigrated()
  const rows = queryAll<BranchRow>(db(), "SELECT * FROM branches ORDER BY created_at")
  return rows.map(branchFromRow)
}

export function getActiveBranch(): StudioBranch | null {
  ensureMigrated()
  const row = queryOne<BranchRow>(db(), "SELECT * FROM branches WHERE active = 1 LIMIT 1")
  return row ? branchFromRow(row) : null
}
