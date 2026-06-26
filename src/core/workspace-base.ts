/**
 * Workspace base — shared infrastructure for all workspace domain modules.
 *
 * Contains: helpers, SQLite row types, row→domain mappers, db connection,
 * ensureMigrated, loadWorkspace/saveWorkspace/resetWorkspaceCache.
 */
import { randomUUID } from "crypto"
import { openStudioDb, queryAll, queryOne } from "./studio-db"
import { ensureStudioDirs } from "./studio-dir"
import {
  emptyWorkspace,
  type StudioWorkspace,
  type StudioPlan,
  type StudioTask,
  type StudioHandoff,
  type StudioBranch,
  type PlanStep,
  type PlanRevision,
  type TaskStatus,
  type BranchStatus,
} from "./workspace-types"
import { currentBranch } from "./branch-context"

// ——— Helpers ———————————————————————————————————

function now(): string {
  return new Date().toISOString()
}

function genId(): string {
  return randomUUID().slice(0, 8)
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || genId()
  )
}

function splitLines(s: string): string[] {
  return s ? s.split("\n").filter((l) => l.length > 0) : []
}

function joinLines(arr: string[]): string {
  return arr.join("\n")
}

function jsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    /* malformed/empty stored JSON — return fallback */
    return fallback
  }
}

function currentBranchSafe(): string {
  try {
    return currentBranch() ?? "main"
  } catch {
    return "main"
    /* not a git repo — default to main */
  }
}

// ——— Internal row types ——————————————————————————————

export interface PlanRow {
  id: string
  title: string
  goal: string
  research: string
  architecture: string
  file_structure: string
  steps_json: string
  acceptance: string
  edge_cases: string
  test_strategy: string
  revisions_json: string
  branch: string | null
  created_at: string
  updated_at: string
  active: number
}

export interface TaskRow {
  id: string
  title: string
  status: string
  acceptance: string
  notes: string
  plan_id: string | null
  branch: string | null
  depends_on: string
  claimed_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
  active: number
}

export interface BranchRow {
  id: string
  title: string
  goal: string
  status: string
  summary: string | null
  parent_branch_id: string | null
  plan_id: string | null
  git_branch: string | null
  created_at: string
  folded_at: string | null
  active: number
}

export interface HandoffRow {
  id: string
  summary: string
  files_changed: string
  tests_run: string | null
  risks: string | null
  next_steps: string | null
  plan_id: string | null
  branch: string | null
  created_at: string
}

// ——— Row → domain object mappers ————————————————

export function planFromRow(r: PlanRow): StudioPlan {
  return {
    id: r.id,
    title: r.title,
    goal: r.goal,
    research: splitLines(r.research),
    architecture: r.architecture,
    fileStructure: r.file_structure,
    steps: jsonParse<PlanStep[]>(r.steps_json, []),
    acceptance: splitLines(r.acceptance),
    edgeCases: r.edge_cases,
    testStrategy: r.test_strategy,
    revisions: jsonParse<PlanRevision[]>(r.revisions_json, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function taskFromRow(r: TaskRow): StudioTask {
  return {
    id: r.id,
    title: r.title,
    status: r.status as TaskStatus,
    acceptance: r.acceptance ? splitLines(r.acceptance) : undefined,
    notes: r.notes || undefined,
    planId: r.plan_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function branchFromRow(r: BranchRow): StudioBranch {
  return {
    id: r.id,
    title: r.title,
    goal: r.goal,
    status: r.status as BranchStatus,
    summary: r.summary ?? undefined,
    parentBranchId: r.parent_branch_id ?? undefined,
    planId: r.plan_id ?? undefined,
    createdAt: r.created_at,
    foldedAt: r.folded_at ?? undefined,
  }
}

export function handoffFromRow(r: HandoffRow): StudioHandoff {
  return {
    id: r.id,
    summary: r.summary,
    filesChanged: splitLines(r.files_changed),
    testsRun: r.tests_run ?? undefined,
    risks: r.risks ?? undefined,
    nextSteps: r.next_steps ?? undefined,
    planId: r.plan_id ?? undefined,
    createdAt: r.created_at,
  }
}

// ——— DB connection + initialization ————————————————

export function db() {
  return openStudioDb(process.cwd())
}

export function ensureMigrated(): void {
  ensureStudioDirs()
}

// ——— Workspace snapshot ————————————————————————————————

export function loadWorkspace(): StudioWorkspace {
  ensureMigrated()
  ensureStudioDirs()
  const d = db()
  const ws = emptyWorkspace()
  ws.updatedAt = now()

  const planRows = queryAll<PlanRow>(d, "SELECT * FROM plans ORDER BY created_at")
  for (const r of planRows) {
    ws.plans[r.id] = planFromRow(r)
    if (r.active) ws.activePlanId = r.id
  }

  const taskRows = queryAll<TaskRow>(d, "SELECT * FROM tasks ORDER BY sort_order, created_at")
  for (const r of taskRows) {
    ws.tasks[r.id] = taskFromRow(r)
    if (r.active && !ws.activeTaskIds.includes(r.id)) ws.activeTaskIds.push(r.id)
  }

  const branchRows = queryAll<BranchRow>(d, "SELECT * FROM branches ORDER BY created_at")
  for (const r of branchRows) {
    ws.branches[r.id] = branchFromRow(r)
    if (r.active) ws.activeBranchId = r.id
  }

  const handoffRows = queryAll<HandoffRow>(d, "SELECT * FROM handoffs ORDER BY created_at")
  ws.handoffs = handoffRows.map(handoffFromRow)

  const ruleRows = queryAll<{ rule: string }>(d, "SELECT rule FROM rules ORDER BY id")
  ws.rules = ruleRows.map((r) => r.rule)

  const pinRows = queryAll<{ block: string }>(d, "SELECT block FROM pinned_context ORDER BY id")
  ws.pinnedContext = pinRows.map((r) => r.block)

  const verifyRow = queryOne<{
    passed: number
    at: string
    commands: string
    retry_count: number
    last_failure: string
  }>(d, "SELECT * FROM verify_state WHERE id = 1")
  if (verifyRow && verifyRow.at) {
    ws.verify = {
      passed: verifyRow.passed === 1,
      at: verifyRow.at,
      commands: splitLines(verifyRow.commands),
    }
    if (verifyRow.retry_count > 0) {
      ws.verifyRetryHint = {
        count: verifyRow.retry_count,
        lastFailure: verifyRow.last_failure,
        at: verifyRow.at,
      }
    }
  }

  return ws
}

export function saveWorkspace(_ws: StudioWorkspace): void {
  /* no-op under SQLite — state is written incrementally */
}

export function resetWorkspaceCache(): void {
  ensureMigrated()
}

// ——— Exported helpers for use by domain modules ————————————————

export { now, genId, slugify, splitLines, joinLines, jsonParse, currentBranchSafe }
