/** Workspace handoffs — structured session summaries for cross-session continuity. */
import { runQuery, queryAll } from "./studio-db"
import type { StudioHandoff } from "./workspace-types"
import {
  db, ensureMigrated, now, genId, joinLines, currentBranchSafe,
  handoffFromRow, type HandoffRow, loadWorkspace,
} from "./workspace-base"

export function saveHandoff(input: Omit<StudioHandoff, "id" | "createdAt">): StudioHandoff {
  ensureMigrated()
  const d = db()
  const ts = now()
  const ws = loadWorkspace()
  const handoffId = genId()
  runQuery(
    d,
    `INSERT INTO handoffs
     (id, summary, files_changed, tests_run, risks, next_steps, plan_id, branch, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      handoffId, input.summary, joinLines(input.filesChanged ?? []),
      input.testsRun ?? null, input.risks ?? null, input.nextSteps ?? null,
      input.planId ?? ws.activePlanId ?? null, currentBranchSafe(), ts,
    ],
  )
  return { id: handoffId, createdAt: ts, ...input, planId: input.planId ?? ws.activePlanId }
}

export function listHandoffs(): StudioHandoff[] {
  ensureMigrated()
  const rows = queryAll<HandoffRow>(db(), "SELECT * FROM handoffs ORDER BY created_at DESC")
  return rows.map(handoffFromRow)
}
