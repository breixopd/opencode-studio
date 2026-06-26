/** Workspace plans — plan CRUD, activation, revision, export. */
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { runQuery, queryOne, queryAll } from "./studio-db"
import { studioRoot } from "./studio-dir"
import { parseMarkdownPlan, formatPlanAsMarkdown, architectureBlock } from "./plan-format"
import type { StudioPlan, PlanStep } from "./workspace-types"
import {
  db, ensureMigrated, now, slugify, joinLines, currentBranchSafe,
  planFromRow, type PlanRow,
} from "./workspace-base"

// ——— Active plan ID ————————————————————————————————

export function setActivePlanId(planId: string | null): void {
  ensureMigrated()
  const d = db()
  d.transaction(() => {
    runQuery(d, "UPDATE plans SET active = 0")
    if (planId) runQuery(d, "UPDATE plans SET active = 1 WHERE id = ?", [planId])
  })()
}

export function getActivePlanId(): string | null {
  ensureMigrated()
  const row = queryOne<{ id: string }>(db(), "SELECT id FROM plans WHERE active = 1 LIMIT 1")
  return row?.id ?? null
}

// ——— Plan CRUD ————————————————————————————————

export function listPlans(): StudioPlan[] {
  ensureMigrated()
  const rows = queryAll<PlanRow>(db(), "SELECT * FROM plans ORDER BY created_at")
  return rows.map(planFromRow)
}

export function getPlan(planId: string): StudioPlan | null {
  ensureMigrated()
  const row = queryOne<PlanRow>(db(), "SELECT * FROM plans WHERE id = ?", [planId])
  return row ? planFromRow(row) : null
}

export function getActivePlan(): StudioPlan | null {
  ensureMigrated()
  const row = queryOne<PlanRow>(db(), "SELECT * FROM plans WHERE active = 1 LIMIT 1")
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

  d.transaction(() => {
    runQuery(d, "UPDATE plans SET active = 0")
    runQuery(
      d,
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
        plan.id, plan.title, plan.goal, joinLines(plan.research),
        plan.architecture, plan.fileStructure, JSON.stringify(plan.steps),
        joinLines(plan.acceptance), plan.edgeCases, plan.testStrategy,
        JSON.stringify(plan.revisions), currentBranchSafe(), createdAt, ts,
      ],
    )
  })()

  exportPlanMarkdown(plan)
  return plan
}

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
    runQuery(d, "UPDATE plans SET active = 0")
    const result = runQuery(d, "UPDATE plans SET active = 1 WHERE id = ?", [planId])
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
  const ts = now()
  const revs = [...active.revisions, { at: ts, reason, note }]
  runQuery(d, "UPDATE plans SET revisions_json = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(revs), ts, active.id,
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
