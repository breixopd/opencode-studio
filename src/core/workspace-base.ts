/**
 * Workspace base — shared infrastructure for all workspace domain modules.
 *
 * Contains: helpers, SQLite row types, row→domain mappers, db connection,
 * ensureMigrated, loadWorkspace/saveWorkspace/resetWorkspaceCache.
 */
import { randomUUID } from "crypto"
import { openStudioDb, queryAll, queryOne, runQuery } from "./studio-db"
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
/** Workspace rules — project-scoped user rules with dedup. */

export interface MemoryHit {
  kind: "rule" | "plan" | "handoff" | "branch"
  id: string
  title: string
  snippet: string
}

export function searchMemory(query: string, limit = 12): MemoryHit[] {
  ensureMigrated()
  const d = db()
  const q = `%${query.toLowerCase()}%`
  const hits: MemoryHit[] = []

  const rules = queryAll<{ rule: string }>(d, "SELECT rule FROM rules WHERE LOWER(rule) LIKE ? LIMIT ?", [q, limit])
  for (const r of rules) hits.push({ kind: "rule", id: "rule", title: "User rule", snippet: r.rule })

  const plans = queryAll<{ id: string; title: string; goal: string }>(
    d, "SELECT id, title, goal FROM plans WHERE LOWER(title) LIKE ? OR LOWER(goal) LIKE ? LIMIT ?", [q, q, limit],
  )
  for (const p of plans) hits.push({ kind: "plan", id: p.id, title: p.title, snippet: p.goal.slice(0, 160) })

  const handoffs = queryAll<{ id: string; summary: string }>(
    d, "SELECT id, summary FROM handoffs WHERE LOWER(summary) LIKE ? LIMIT ?", [q, limit],
  )
  for (const h of handoffs) hits.push({ kind: "handoff", id: h.id, title: h.summary.slice(0, 60), snippet: h.summary.slice(0, 160) })

  const branches = queryAll<{ id: string; title: string; summary: string }>(
    d, "SELECT id, title, summary FROM branches WHERE status = 'folded' AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ?) LIMIT ?", [q, q, limit],
  )
  for (const b of branches) hits.push({ kind: "branch", id: b.id, title: b.title, snippet: b.summary?.slice(0, 160) ?? "" })

  return hits.slice(0, limit)
}

// ——— Rules ————————————————————————————————

export function listRules(): string[] {
  ensureMigrated()
  return queryAll<{ rule: string }>(db(), "SELECT rule FROM rules ORDER BY id").map((r) => r.rule)
}

export function addRule(rule: string): string[] {
  ensureMigrated()
  const trimmed = rule.trim()
  if (!trimmed) throw new Error("Rule must not be empty")
  runQuery(db(), "INSERT OR IGNORE INTO rules (rule, created_at) VALUES (?, ?)", [trimmed, now()])
  return listRules()
}

export function removeRule(rule: string): string[] {
  ensureMigrated()
  runQuery(db(), "DELETE FROM rules WHERE rule = ?", [rule.trim()])
  return listRules()
}

export function formatRules(rules: string[]): string {
  return rules.map((r) => `- ${r}`).join("\n")
}

// ——— Pinned context ————————————————————————————————

const MAX_PINNED_BLOCKS = 50
const MAX_PIN_BLOCK_CHARS = 8000

export function listPinnedContext(): string[] {
  ensureMigrated()
  return queryAll<{ block: string }>(db(), "SELECT block FROM pinned_context ORDER BY id").map((r) => r.block)
}

export function pinContext(block: string): string[] {
  ensureMigrated()
  const trimmed = block.trim().slice(0, MAX_PIN_BLOCK_CHARS)
  if (!trimmed) throw new Error("Context block must not be empty")
  const d = db()
  d.transaction(() => {
    const count = (queryOne<{ c: number }>(d, "SELECT COUNT(*) AS c FROM pinned_context") ?? { c: 0 }).c
    if (count >= MAX_PINNED_BLOCKS) runQuery(d, "DELETE FROM pinned_context WHERE id = (SELECT MIN(id) FROM pinned_context)")
    runQuery(d, "INSERT INTO pinned_context (block, pinned_at) VALUES (?, ?)", [trimmed, now()])
  })()
  return listPinnedContext()
}

export function unpinContext(index: number): string[] {
  ensureMigrated()
  if (index < 0) throw new Error(`Invalid pin index: ${index}`)
  const rows = queryAll<{ id: number }>(db(), "SELECT id FROM pinned_context ORDER BY id")
  if (index >= rows.length) throw new Error(`Invalid pin index: ${index}`)
  runQuery(db(), "DELETE FROM pinned_context WHERE id = ?", [rows[index].id])
  return listPinnedContext()
}

export function clearPinnedContext(): void {
  ensureMigrated()
  runQuery(db(), "DELETE FROM pinned_context")
}

// ——— Handoffs ————————————————————————————————

export function saveHandoff(input: Omit<StudioHandoff, "id" | "createdAt">): StudioHandoff {
  ensureMigrated()
  const d = db()
  const ts = now()
  const ws = loadWorkspace()
  const handoffId = genId()
  runQuery(
    d,
    `INSERT INTO handoffs (id, summary, files_changed, tests_run, risks, next_steps, plan_id, branch, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [handoffId, input.summary, joinLines(input.filesChanged ?? []), input.testsRun ?? null,
     input.risks ?? null, input.nextSteps ?? null, input.planId ?? ws.activePlanId ?? null,
     currentBranchSafe(), ts],
  )
  return { id: handoffId, createdAt: ts, ...input, planId: input.planId ?? ws.activePlanId }
}

export function listHandoffs(): StudioHandoff[] {
  ensureMigrated()
  return queryAll<HandoffRow>(db(), "SELECT * FROM handoffs ORDER BY created_at DESC").map(handoffFromRow)
}

