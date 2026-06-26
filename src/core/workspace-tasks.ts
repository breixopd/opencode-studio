/** Workspace tasks — task board CRUD with branch-aware filtering. */
import { runQuery, queryOne, queryAll } from "./studio-db"
import type { StudioTask } from "./workspace-types"
import {
  db, ensureMigrated, now, genId, joinLines, currentBranchSafe,
  taskFromRow, type TaskRow,
} from "./workspace-base"
import { getActivePlan } from "./workspace-plans"
import { loadWorkspace } from "./workspace-base"

export function listTasks(): StudioTask[] {
  ensureMigrated()
  const rows = queryAll<TaskRow>(db(), "SELECT * FROM tasks ORDER BY sort_order, created_at")
  return rows.map(taskFromRow)
}

export function getTask(taskId: string): StudioTask | null {
  ensureMigrated()
  const row = queryOne<TaskRow>(db(), "SELECT * FROM tasks WHERE id = ?", [taskId])
  return row ? taskFromRow(row) : null
}

export function incompleteTasks(): StudioTask[] {
  ensureMigrated()
  const branch = currentBranchSafe()
  const rows = queryAll<TaskRow>(
    db(),
    `SELECT * FROM tasks WHERE status IN ('pending','in_progress') AND (branch = ? OR branch IS NULL) ORDER BY sort_order, created_at`,
    [branch],
  )
  return rows.map(taskFromRow)
}

export function createTask(title: string, acceptance?: string[]): StudioTask {
  ensureMigrated()
  const d = db()
  const ts = now()
  const taskId = genId()
  const planId = getActivePlan()?.id
  const branch = currentBranchSafe()
  const maxOrder = (queryOne<{ m: number | null }>(d, "SELECT MAX(sort_order) AS m FROM tasks") ?? { m: null }).m ?? -1
  runQuery(
    d,
    `INSERT INTO tasks
     (id, title, status, acceptance, notes, plan_id, branch, depends_on, claimed_by, sort_order, created_at, updated_at, active)
     VALUES (?, ?, 'pending', ?, '', ?, ?, '', NULL, ?, ?, ?, 1)`,
    [taskId, title.slice(0, 500), acceptance ? joinLines(acceptance) : "", planId ?? null, branch, maxOrder + 1, ts, ts],
  )
  return getTask(taskId)!
}

export function updateTask(
  taskId: string,
  patch: Partial<Pick<StudioTask, "title" | "status" | "acceptance" | "notes">>,
): StudioTask {
  ensureMigrated()
  const d = db()
  const sets: string[] = []
  const params: (string | number)[] = []
  if (patch.title !== undefined) { sets.push("title = ?"); params.push(patch.title.slice(0, 500)) }
  if (patch.status !== undefined) { sets.push("status = ?"); params.push(patch.status) }
  if (patch.acceptance !== undefined) { sets.push("acceptance = ?"); params.push(joinLines(patch.acceptance)) }
  if (patch.notes !== undefined) { sets.push("notes = ?"); params.push(patch.notes.slice(0, 5000)) }
  if (sets.length === 0) return getTask(taskId)!
  sets.push("updated_at = ?")
  params.push(now())
  params.push(taskId)
  const result = runQuery(d, `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params)
  if (result.changes === 0) throw new Error(`Task not found: ${taskId}`)
  return getTask(taskId)!
}

export function setActiveTasks(taskIds: string[]): void {
  ensureMigrated()
  const d = db()
  d.transaction(() => {
    runQuery(d, "UPDATE tasks SET active = 0")
    for (const tid of taskIds.slice(-100)) { /* keep last 100 active */
      runQuery(d, "UPDATE tasks SET active = 1 WHERE id = ?", [tid])
    }
  })()
}

export function getActiveTasks(): StudioTask[] {
  ensureMigrated()
  const rows = queryAll<TaskRow>(db(), "SELECT * FROM tasks WHERE active = 1 ORDER BY sort_order")
  return rows.map(taskFromRow)
}

export function getWorkflowState() {
  ensureMigrated()
  const ws = loadWorkspace()
  return {
    activePlanId: ws.activePlanId,
    activeTaskIds: ws.activeTaskIds,
    activeBranchId: ws.activeBranchId,
    updatedAt: ws.updatedAt,
  }
}
