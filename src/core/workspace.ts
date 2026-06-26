/**
 * Workspace state — plans, tasks, rules, branches, handoffs, pins, verify.
 *
 * Backed by SQLite (`.studio/studio.db`). All state lives in the unified
 * database — no JSON files, no dual storage paths.
 */
import { randomUUID } from "crypto"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { openStudioDb, queryAll, queryOne, runQuery } from "./studio-db"
import { studioRoot, ensureStudioDirs } from "./studio-dir"
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
  type VerifyState,
  type VerifyRetryHint,
} from "./workspace-types"
import { parseMarkdownPlan, formatPlanAsMarkdown, architectureBlock } from "./plan-format"
import { projectContextBlock } from "./project-profile"
import { currentBranch } from "./branch-context"

// ——— Helpers ———————————————————————————————————

const MAX_PLAN_CONTEXT_CHARS = 12_000

function now(): string {
  return new Date().toISOString()
}

function id(): string {
  return randomUUID().slice(0, 8)
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || id()
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
    return fallback
  }
}

// ——— Internal row shapes ——————————————————————————————

interface PlanRow {
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

interface TaskRow {
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

interface BranchRow {
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

interface HandoffRow {
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

function planFromRow(r: PlanRow): StudioPlan {
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

function taskFromRow(r: TaskRow): StudioTask {
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

function branchFromRow(r: BranchRow): StudioBranch {
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

function handoffFromRow(r: HandoffRow): StudioHandoff {
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

function db() {
  return openStudioDb(process.cwd())
}

// ——— Legacy JSON migration (one-shot) ————————————————

/** Ensures the studio directory + DB are initialized. Idempotent. */
function ensureMigrated(): void {
  ensureStudioDirs()
}

// ——— Workspace snapshot (compat: used by report/status) ————

export function loadWorkspace(): StudioWorkspace {
  ensureMigrated()
  ensureStudioDirs()
  const d = db()
  const ws = emptyWorkspace()
  ws.updatedAt = now()

  const planRows = d.query("SELECT * FROM plans ORDER BY created_at").all() as PlanRow[]
  for (const r of planRows) {
    ws.plans[r.id] = planFromRow(r)
    if (r.active) ws.activePlanId = r.id
  }

  const taskRows = d.query("SELECT * FROM tasks ORDER BY sort_order, created_at").all() as TaskRow[]
  for (const r of taskRows) {
    ws.tasks[r.id] = taskFromRow(r)
    if (r.active && !ws.activeTaskIds.includes(r.id)) ws.activeTaskIds.push(r.id)
  }

  const branchRows = d.query("SELECT * FROM branches ORDER BY created_at").all() as BranchRow[]
  for (const r of branchRows) {
    ws.branches[r.id] = branchFromRow(r)
    if (r.active) ws.activeBranchId = r.id
  }

  const handoffRows = d.query("SELECT * FROM handoffs ORDER BY created_at").all() as HandoffRow[]
  ws.handoffs = handoffRows.map(handoffFromRow)

  const ruleRows = d.query("SELECT rule FROM rules ORDER BY id").all() as { rule: string }[]
  ws.rules = ruleRows.map((r) => r.rule)

  const pinRows = d.query("SELECT block FROM pinned_context ORDER BY id").all() as { block: string }[]
  ws.pinnedContext = pinRows.map((r) => r.block)

  const verifyRow = d.query("SELECT * FROM verify_state WHERE id = 1").get() as
    | {
        passed: number
        at: string
        commands: string
        retry_count: number
        last_failure: string
      }
    | null
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

/** Compat no-op — state is written incrementally via the specific calls now. */
export function saveWorkspace(_ws: StudioWorkspace): void {
  // No-op under SQLite. Kept for API compatibility.
}

export function resetWorkspaceCache(): void {
  // No-op under SQLite — every read is a fresh query.
  ensureMigrated()
}

// ——— Rules ————————————————————————————————————

export function listRules(): string[] {
  ensureMigrated()
  const rows = db().query("SELECT rule FROM rules ORDER BY id").all() as { rule: string }[]
  return rows.map((r) => r.rule)
}

export function addRule(rule: string): string[] {
  ensureMigrated()
  const trimmed = rule.trim()
  if (!trimmed) throw new Error("Rule must not be empty")
  db().run("INSERT OR IGNORE INTO rules (rule, created_at) VALUES (?, ?)", [trimmed, now()])
  return listRules()
}

export function removeRule(rule: string): string[] {
  ensureMigrated()
  db().run("DELETE FROM rules WHERE rule = ?", [rule.trim()])
  return listRules()
}

export function formatRules(rules: string[]): string {
  return rules.map((r) => `- ${r}`).join("\n")
}

// ——— Plans ————————————————————————————————————

export function listPlans(): StudioPlan[] {
  ensureMigrated()
  const rows = db().query("SELECT * FROM plans ORDER BY created_at").all() as PlanRow[]
  return rows.map(planFromRow)
}

export function getPlan(planId: string): StudioPlan | null {
  ensureMigrated()
  const row = queryOne<PlanRow>(db(), "SELECT * FROM plans WHERE id = ?", [planId])
  return row ? planFromRow(row) : null
}

export function getActivePlan(): StudioPlan | null {
  ensureMigrated()
  const row = db().query("SELECT * FROM plans WHERE active = 1 LIMIT 1").get() as PlanRow | null
  return row ? planFromRow(row) : null
}

export function savePlan(
  name: string,
  input: {
    markdown?: string
    goal?: string
    research?: string[]
    architecture?: string
    fileStructure?: string
    steps?: PlanStep[]
    acceptance?: string[]
    edgeCases?: string
    testStrategy?: string
  },
): StudioPlan {
  ensureMigrated()
  const d = db()
  const planId = slugify(name)
  const ts = now()
  const existing = getPlan(planId)
  const createdAt = existing?.createdAt ?? ts

  let plan: StudioPlan
  if (input.markdown) {
    plan = parseMarkdownPlan(planId, name, input.markdown, createdAt)
    if (existing?.revisions.length) plan.revisions = existing.revisions
  } else {
    plan = {
      id: planId,
      title: name,
      goal: input.goal ?? existing?.goal ?? "",
      research: input.research ?? existing?.research ?? [],
      architecture: input.architecture ?? existing?.architecture ?? "",
      fileStructure: input.fileStructure ?? existing?.fileStructure ?? "",
      steps: input.steps ?? existing?.steps ?? [],
      acceptance: input.acceptance ?? existing?.acceptance ?? [],
      edgeCases: input.edgeCases ?? existing?.edgeCases ?? "",
      testStrategy: input.testStrategy ?? existing?.testStrategy ?? "",
      revisions: existing?.revisions ?? [],
      createdAt,
      updatedAt: ts,
    }
  }
  plan.updatedAt = ts

  // Persist + mark active in one transaction (atomic — fixes the old double-write bug).
  d.transaction(() => {
    d.run("UPDATE plans SET active = 0")
    d.run(
      `INSERT INTO plans
       (id, title, goal, research, architecture, file_structure, steps_json, acceptance,
        edge_cases, test_strategy, revisions_json, branch, created_at, updated_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, goal=excluded.goal, research=excluded.research,
         architecture=excluded.architecture, file_structure=excluded.file_structure,
         steps_json=excluded.steps_json, acceptance=excluded.acceptance,
         edge_cases=excluded.edge_cases, test_strategy=excluded.test_strategy,
         revisions_json=excluded.revisions_json, updated_at=excluded.updated_at, active=1`,
      [
        plan.id,
        plan.title,
        plan.goal,
        joinLines(plan.research),
        plan.architecture,
        plan.fileStructure,
        JSON.stringify(plan.steps),
        joinLines(plan.acceptance),
        plan.edgeCases,
        plan.testStrategy,
        JSON.stringify(plan.revisions),
        currentBranchSafe(),
        createdAt,
        ts,
      ],
    )
  })()

  exportPlanMarkdown(plan)
  return plan
}

function currentBranchSafe(): string {
  try {
    return currentBranch() ?? "main"
  } catch {
    return "main"
  }
}

/** Write the plan as markdown to .studio/plans/<id>.md (Tier S #2 — persistent plan files). */
export function exportPlanMarkdown(plan: StudioPlan): void {
  try {
    const dir = join(studioRoot(), "plans")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${plan.id}.md`), formatPlanAsMarkdown(plan), "utf-8")
  } catch {
    /* best-effort — never block a save on the export */
  }
}

export function activatePlan(planId: string): StudioPlan {
  ensureMigrated()
  const d = db()
  d.transaction(() => {
    d.run("UPDATE plans SET active = 0")
    const result = d.run("UPDATE plans SET active = 1 WHERE id = ?", [planId])
    if (result.changes === 0) throw new Error(`Plan not found: ${planId}`)
  })()
  const plan = getPlan(planId)
  if (plan) exportPlanMarkdown(plan)
  return plan!
}

export function reviseActivePlan(reason: string, note: string): StudioPlan | null {
  ensureMigrated()
  const d = db()
  const active = getActivePlan()
  if (!active) return null
  const revs = [...active.revisions, { at: now(), reason, note }]
  d.run("UPDATE plans SET revisions_json = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(revs),
    now(),
    active.id,
  ])
  const updated = getPlan(active.id)!
  exportPlanMarkdown(updated)
  return updated
}

export function readPlanMarkdown(planId: string): string {
  ensureMigrated()
  const plan = getPlan(planId)
  if (!plan) throw new Error(`Plan not found: ${planId}`)
  return formatPlanAsMarkdown(plan)
}

export function activeArchitectureText(): string | null {
  const plan = getActivePlan()
  if (!plan) return null
  return architectureBlock(plan) || null
}

// ——— Tasks ————————————————————————————————————

export function listTasks(): StudioTask[] {
  ensureMigrated()
  const rows = db().query("SELECT * FROM tasks ORDER BY sort_order, created_at").all() as TaskRow[]
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
  // Filter: show tasks for this branch OR tasks with no branch set (backward-compat).
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
  const taskId = id()
  const planId = getActivePlan()?.id
  const branch = currentBranchSafe()
  const maxOrder = (d.query("SELECT MAX(sort_order) AS m FROM tasks").get() as { m: number | null }).m ?? -1
  d.run(
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
  if (patch.title !== undefined) {
    sets.push("title = ?")
    params.push(patch.title.slice(0, 500))
  }
  if (patch.status !== undefined) {
    sets.push("status = ?")
    params.push(patch.status)
  }
  if (patch.acceptance !== undefined) {
    sets.push("acceptance = ?")
    params.push(joinLines(patch.acceptance))
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?")
    params.push(patch.notes.slice(0, 5000))
  }
  if (sets.length === 0) return getTask(taskId)!
  sets.push("updated_at = ?")
  params.push(now())
  params.push(taskId)
  const result = d.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params)
  if (result.changes === 0) throw new Error(`Task not found: ${taskId}`)
  return getTask(taskId)!
}

export function setActiveTasks(taskIds: string[]): void {
  ensureMigrated()
  const d = db()
  d.transaction(() => {
    d.run("UPDATE tasks SET active = 0")
    for (const tid of taskIds.slice(-100)) {
      d.run("UPDATE tasks SET active = 1 WHERE id = ?", [tid])
    }
  })()
}

export function getActiveTasks(): StudioTask[] {
  ensureMigrated()
  const rows = db().query("SELECT * FROM tasks WHERE active = 1 ORDER BY sort_order").all() as TaskRow[]
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

// ——— Branches ————————————————————————————————————

export function openBranch(title: string, goal: string): StudioBranch {
  ensureMigrated()
  const d = db()
  const ts = now()
  const branchId = id()
  const ws = loadWorkspace()
  d.transaction(() => {
    d.run("UPDATE branches SET active = 0")
    d.run(
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
        d,
        "SELECT parent_branch_id FROM branches WHERE id = ?",
        [branchId],
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
  const rows = db().query("SELECT * FROM branches ORDER BY created_at").all() as BranchRow[]
  return rows.map(branchFromRow)
}

export function getActiveBranch(): StudioBranch | null {
  ensureMigrated()
  const row = db().query("SELECT * FROM branches WHERE active = 1 LIMIT 1").get() as BranchRow | null
  return row ? branchFromRow(row) : null
}

// ——— Handoffs ————————————————————————————————————

export function saveHandoff(input: Omit<StudioHandoff, "id" | "createdAt">): StudioHandoff {
  ensureMigrated()
  const d = db()
  const ts = now()
  const ws = loadWorkspace()
  const handoffId = id()
  d.run(
    `INSERT INTO handoffs
     (id, summary, files_changed, tests_run, risks, next_steps, plan_id, branch, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      handoffId,
      input.summary,
      joinLines(input.filesChanged ?? []),
      input.testsRun ?? null,
      input.risks ?? null,
      input.nextSteps ?? null,
      input.planId ?? ws.activePlanId ?? null,
      currentBranchSafe(),
      ts,
    ],
  )
  return {
    id: handoffId,
    createdAt: ts,
    ...input,
    planId: input.planId ?? ws.activePlanId,
  }
}

export function listHandoffs(): StudioHandoff[] {
  ensureMigrated()
  const rows = db().query("SELECT * FROM handoffs ORDER BY created_at DESC").all() as HandoffRow[]
  return rows.map(handoffFromRow)
}

// ——— Memory search ————————————————————————————————————

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
  for (const r of rules) {
    hits.push({ kind: "rule", id: "rule", title: "User rule", snippet: r.rule })
  }

  const plans = queryAll<{ id: string; title: string; goal: string }>(
    d,
    "SELECT id, title, goal FROM plans WHERE LOWER(title) LIKE ? OR LOWER(goal) LIKE ? LIMIT ?",
    [q, q, limit],
  )
  for (const p of plans) {
    hits.push({ kind: "plan", id: p.id, title: p.title, snippet: p.goal.slice(0, 160) })
  }

  const handoffs = queryAll<{ id: string; summary: string }>(
    d,
    "SELECT id, summary FROM handoffs WHERE LOWER(summary) LIKE ? LIMIT ?",
    [q, limit],
  )
  for (const h of handoffs) {
    hits.push({ kind: "handoff", id: h.id, title: h.summary.slice(0, 60), snippet: h.summary.slice(0, 160) })
  }

  const branches = queryAll<{ id: string; title: string; summary: string }>(
    d,
    "SELECT id, title, summary FROM branches WHERE status = 'folded' AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ?) LIMIT ?",
    [q, q, limit],
  )
  for (const b of branches) {
    hits.push({ kind: "branch", id: b.id, title: b.title, snippet: b.summary?.slice(0, 160) ?? "" })
  }

  return hits.slice(0, limit)
}

// ——— Session context (injected each turn) ————————————————

export function rememberRulesText(): string | null {
  const rules = listRules()
  return rules.length ? formatRules(rules) : null
}

export function activePlanContextBlock(): string | null {
  const plan = getActivePlan()
  const branch = getActiveBranch()
  if (!plan && !branch) return null

  const parts: string[] = ["[studio] Follow the active plan unless the user changes direction."]

  if (plan) {
    let md = formatPlanAsMarkdown(plan)
    if (md.length > MAX_PLAN_CONTEXT_CHARS) {
      md = `${md.slice(0, MAX_PLAN_CONTEXT_CHARS)}\n\n…(truncated — studio_plan read)`
    }
    parts.push(md)
  }

  if (branch?.status === "open") {
    parts.push(`[studio branch] ${branch.title}: ${branch.goal}`)
  }

  const folded = listBranches()
    .filter((b) => b.status === "folded" && b.summary)
    .slice(-3)
  if (folded.length) {
    parts.push(
      "[studio branch] Folded:\n" + folded.map((b) => `- ${b.title}: ${b.summary}`).join("\n"),
    )
  }

  return parts.join("\n\n")
}

export function studioPersistentContext(): string[] {
  // Order matters: stable prefix first (project, rules), dynamic suffix last
  // (plan, pinned, verify). This enables prompt-cache hits on Anthropic/OpenAI
  // since the prefix rarely changes across turns.
  return [...studioStableContext(), ...studioDynamicContext()]
}

/** Stable context blocks — rarely change, placed at start for prompt cache hits. */
export function studioStableContext(): string[] {
  const blocks: string[] = []

  const project = projectContextBlock()
  if (project) blocks.push(project)

  const remember = rememberRulesText()
  if (remember) {
    blocks.push(`[studio remember] Project rules:\n${remember}`)
  }

  return blocks
}

/** Dynamic context blocks — change per-turn, placed after the stable prefix. */
export function studioDynamicContext(): string[] {
  const blocks: string[] = []

  const plan = activePlanContextBlock()
  if (plan) blocks.push(plan)

  const pinned = listPinnedContext()
  if (pinned.length) {
    blocks.push(
      "[studio context] Pinned (survives compaction):\n" +
        pinned.map((p, i) => `${i + 1}. ${p}`).join("\n"),
    )
  }

  const verify = getVerifyState()
  if (verify && !verify.passed) {
    blocks.push("[studio verify] Last run FAILED — fix issues and re-run studio_verify before handoff.")
  }

  return blocks
}

// ——— Verify state ————————————————————————————————————

export function recordVerifyFailure(command: string, output: string): StudioPlan | null {
  ensureMigrated()
  const d = db()
  const ts = now()
  // Atomic transaction wraps verify_state write AND plan revision.
  d.transaction(() => {
    const existing = queryOne<{ retry_count: number }>(
      d,
      "SELECT retry_count FROM verify_state WHERE id = 1",
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

  // Export the plan markdown outside the transaction (best-effort).
  const active = getActivePlan()
  if (active) exportPlanMarkdown(active)
  return active
}

export function recordVerifySuccess(commands: string[]): void {
  ensureMigrated()
  const ts = now()
  db().run(
    `INSERT INTO verify_state (id, passed, at, commands, retry_count, last_failure)
     VALUES (1, 1, ?, ?, 0, '')
     ON CONFLICT(id) DO UPDATE SET passed=1, at=excluded.at, commands=excluded.commands, retry_count=0, last_failure=''`,
    [ts, joinLines(commands)],
  )
}

export function getVerifyState(): VerifyState | undefined {
  ensureMigrated()
  const row = db().query("SELECT * FROM verify_state WHERE id = 1").get() as
    | { passed: number; at: string; commands: string }
    | null
  if (!row || !row.at) return undefined
  return {
    passed: row.passed === 1,
    at: row.at,
    commands: splitLines(row.commands),
  }
}

export function getVerifyRetryHint(): VerifyRetryHint | undefined {
  ensureMigrated()
  const row = db().query("SELECT retry_count, last_failure, at FROM verify_state WHERE id = 1").get() as
    | { retry_count: number; last_failure: string; at: string }
    | null
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

// ——— Pinned context ————————————————————————————————————

const MAX_PINNED_BLOCKS = 50
const MAX_PIN_BLOCK_CHARS = 8000

export function listPinnedContext(): string[] {
  ensureMigrated()
  const rows = db().query("SELECT block FROM pinned_context ORDER BY id").all() as { block: string }[]
  return rows.map((r) => r.block)
}

export function pinContext(block: string): string[] {
  ensureMigrated()
  const trimmed = block.trim().slice(0, MAX_PIN_BLOCK_CHARS)
  if (!trimmed) throw new Error("Context block must not be empty")
  const d = db()
  d.transaction(() => {
    const count = (d.query("SELECT COUNT(*) AS c FROM pinned_context").get() as { c: number }).c
    if (count >= MAX_PINNED_BLOCKS) {
      d.run("DELETE FROM pinned_context WHERE id = (SELECT MIN(id) FROM pinned_context)")
    }
    d.run("INSERT INTO pinned_context (block, pinned_at) VALUES (?, ?)", [trimmed, now()])
  })()
  return listPinnedContext()
}

export function unpinContext(index: number): string[] {
  ensureMigrated()
  if (index < 0) throw new Error(`Invalid pin index: ${index}`)
  const rows = db().query("SELECT id FROM pinned_context ORDER BY id").all() as { id: number }[]
  if (index >= rows.length) throw new Error(`Invalid pin index: ${index}`)
  db().run("DELETE FROM pinned_context WHERE id = ?", [rows[index].id])
  return listPinnedContext()
}

export function clearPinnedContext(): void {
  ensureMigrated()
  db().run("DELETE FROM pinned_context")
}

// ——— Active state setters ————————————————————————————————————

export function setActivePlanId(planId: string | null): void {
  ensureMigrated()
  const d = db()
  d.transaction(() => {
    d.run("UPDATE plans SET active = 0")
    if (planId) d.run("UPDATE plans SET active = 1 WHERE id = ?", [planId])
  })()
}

export function getActivePlanId(): string | null {
  ensureMigrated()
  const row = db().query("SELECT id FROM plans WHERE active = 1 LIMIT 1").get() as { id: string } | null
  return row?.id ?? null
}
