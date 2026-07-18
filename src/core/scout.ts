/**
 * Autonomous improvement scout — finds polish, test gaps, research opportunities,
 * and verification issues without the user asking.
 *
 * Runs cheap heuristics (diagnostics, working set, tasks, verify state, index
 * hotspots, missing tests). Findings are injected into session context when
 * autonomy is enabled (default). User can disable via:
 *   studio_preferences set_autonomy off
 * or by saying "don't scout" / "no autonomy" / "stop suggesting improvements".
 */
import { existsSync, readdirSync, statSync } from "fs"
import { basename, dirname, extname, join, relative } from "path"
import { getDiagnosticsSummary, getDiagnostics } from "./diagnostics"
import { getWorkingSet } from "./passive-context"
import { incompleteTasks, listTasks, createTask } from "./workspace-tasks"
import { getActivePlan } from "./workspace-plans"
import { getVerifyState, getVerifyRetryHint } from "./workspace-verify"
import { loadProjectProfile, getAutonomyMode, type AutonomyMode } from "./project-profile"
import { findHotspots } from "./code-query"
import { getCISummary } from "./ci-watcher"
import { constitutionContextBlock } from "./constitution"
import * as log from "./logger"
import { getActiveDirectory } from "./active-dir"

export type ScoutSeverity = "high" | "medium" | "low"

export interface ScoutFinding {
  id: string
  severity: ScoutSeverity
  category: "verify" | "tests" | "polish" | "research" | "security" | "deps" | "process"
  title: string
  detail: string
  /** Suggested next action for the agent */
  action: string
}

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".rb", ".php",
  ".swift", ".kt", ".cs", ".c", ".cpp", ".h",
])

const TEST_HINTS = /(?:\.test\.|\.spec\.|_test\.|_spec\.|\/tests?\/|\/__tests__\/|test_)/i

/** Cache scout results briefly so discipline hook stays cheap. */
let cache: { at: number; root: string; findings: ScoutFinding[] } | null = null
const CACHE_MS = 45_000

export function invalidateScoutCache(): void {
  cache = null
}

export function runScout(root = getActiveDirectory(), max = 8): ScoutFinding[] {
  if (cache && cache.root === root && Date.now() - cache.at < CACHE_MS) {
    return cache.findings.slice(0, max)
  }

  const findings: ScoutFinding[] = []

  try {
    collectVerifyFindings(findings, root)
    collectDiagnosticFindings(findings, root)
    collectTestGapFindings(findings, root)
    collectTaskFindings(findings)
    collectPlanFindings(findings)
    collectHotspotFindings(findings, root)
    collectProcessFindings(findings, root)
    collectCiFindings(findings)
  } catch (err) {
    log.debugCatch("scout.run", err)
  }

  const ranked = rankFindings(findings).slice(0, max)
  cache = { at: Date.now(), root, findings: ranked }
  return ranked
}

function collectVerifyFindings(out: ScoutFinding[], _root: string): void {
  const state = getVerifyState()
  const hint = getVerifyRetryHint()
  if (state && !state.passed) {
    out.push({
      id: "verify-fail",
      severity: "high",
      category: "verify",
      title: "Last verify failed",
      detail: hint?.lastFailure?.slice(0, 200) || "Verification did not pass",
      action: "Spawn @studio-implement to fix, then re-run studio_verify. Pin failure with studio_context pin.",
    })
  }
  if (hint && hint.count >= 2) {
    out.push({
      id: "verify-grind",
      severity: "high",
      category: "verify",
      title: `Verify grind ${hint.count}/3`,
      detail: "Repeated verify failures — consider snapshot rollback",
      action: "studio_verify only=rollback if changes are thrashing, else fix root cause and re-verify",
    })
  }
}

function collectDiagnosticFindings(out: ScoutFinding[], root: string): void {
  const summary = getDiagnosticsSummary(root)
  if (summary.errors > 0) {
    const top = getDiagnostics(root, "error", 3)
    const sample = top.map((d) => `${relative(root, d.file)}:${d.line} ${d.message.slice(0, 80)}`).join("; ")
    out.push({
      id: "lsp-errors",
      severity: "high",
      category: "verify",
      title: `${summary.errors} LSP error(s)`,
      detail: sample || "Type/lint errors present",
      action: "Fix LSP errors before continuing. Prefer smallest fix; re-check with studio_verify.",
    })
  } else if (summary.warnings >= 5) {
    out.push({
      id: "lsp-warnings",
      severity: "low",
      category: "polish",
      title: `${summary.warnings} LSP warnings`,
      detail: "Accumulated warnings — good polish candidates",
      action: "Triage warnings in the working set; file studio_task for non-trivial cleanups",
    })
  }
}

function collectTestGapFindings(out: ScoutFinding[], root: string): void {
  const working = getWorkingSet(8)
  const gaps: string[] = []
  for (const file of working) {
    if (!CODE_EXTS.has(extname(file))) continue
    if (TEST_HINTS.test(file)) continue
    if (looksLikeTestCompanionMissing(file, root)) {
      gaps.push(relative(root, file))
    }
  }
  if (gaps.length) {
    out.push({
      id: "test-gaps",
      severity: "medium",
      category: "tests",
      title: `Missing tests near ${gaps.length} edited file(s)`,
      detail: gaps.slice(0, 4).join(", "),
      action: "Write failing tests first (TDD), then implement. Use studio_verify before handoff.",
    })
  }
}

function looksLikeTestCompanionMissing(file: string, root: string): boolean {
  const abs = file.startsWith("/") ? file : join(root, file)
  if (!existsSync(abs)) return false
  const dir = dirname(abs)
  const base = basename(abs, extname(abs))
  const ext = extname(abs)
  const candidates = [
    join(dir, `${base}.test${ext}`),
    join(dir, `${base}.spec${ext}`),
    join(dir, "__tests__", `${base}.test${ext}`),
    join(dir, "tests", `${base}.test${ext}`),
    join(root, "tests", `${base}.test${ext}`),
    join(root, "test", `${base}.test${ext}`),
  ]
  if (candidates.some((c) => existsSync(c))) return false
  // Also accept sibling *test* files that mention the base name
  try {
    const siblings = readdirSync(dir)
    if (siblings.some((s) => TEST_HINTS.test(s) && s.includes(base))) return false
  } catch {
    /* ignore */
  }
  return true
}

function collectTaskFindings(out: ScoutFinding[]): void {
  const open = incompleteTasks()
  const all = listTasks()
  const blocked = all.filter((t) => t.status === "blocked")
  if (blocked.length) {
    out.push({
      id: "blocked-tasks",
      severity: "medium",
      category: "process",
      title: `${blocked.length} blocked task(s)`,
      detail: blocked.slice(0, 3).map((t) => t.title).join("; "),
      action: "Unblock or re-scope with studio_task; research unknowns with @studio-research",
    })
  }
  // When the board is empty and verify isn't failing, nudge proactive polish.
  if (open.length === 0 && blocked.length === 0) {
    const verify = getVerifyState()
    if (!verify || verify.passed) {
      out.push({
        id: "idle-polish",
        severity: "low",
        category: "polish",
        title: "No open tasks — room to improve",
        detail: "Session has capacity for proactive polish",
        action: "Run studio_scout, then propose 1–3 small improvements (tests, dead code, docs). Ask only if high-risk.",
      })
    }
  }
}

function collectPlanFindings(out: ScoutFinding[]): void {
  const plan = getActivePlan()
  if (plan && (!plan.testStrategy || plan.testStrategy.trim().length < 20)) {
    out.push({
      id: "plan-tests",
      severity: "medium",
      category: "tests",
      title: "Active plan lacks test strategy",
      detail: plan.goal.slice(0, 120),
      action: "studio_plan revise — add concrete test strategy and acceptance checks",
    })
  }
}

function collectHotspotFindings(out: ScoutFinding[], root: string): void {
  try {
    const hotspots = findHotspots(root, 5)
    const heavy = hotspots.filter((h) => h.inDegree >= 8)
    if (heavy.length) {
      out.push({
        id: "hotspots",
        severity: "low",
        category: "research",
        title: "High-coupling hotspots",
        detail: heavy.map((h) => `${h.name} (${h.inDegree} refs)`).join(", "),
        action: "studio_index impact + studio_refactor structure before large changes; consider extracting seams",
      })
    }
  } catch (err) {
    log.debugCatch("scout.hotspots", err)
  }
}

function collectProcessFindings(out: ScoutFinding[], root: string): void {
  const profile = loadProjectProfile(root)
  if (profile.openConcerns.length >= 2) {
    out.push({
      id: "open-concerns",
      severity: "medium",
      category: "process",
      title: `${profile.openConcerns.length} open concerns from prior handoffs`,
      detail: profile.openConcerns.slice(-2).join(" | ").slice(0, 200),
      action: "Address or dismiss via studio_task / studio_remember; don't leave concerns rotting",
    })
  }
  if (!constitutionContextBlock(root)) {
    // Only suggest if project looks non-trivial
    try {
      const pkg = join(root, "package.json")
      const py = join(root, "pyproject.toml")
      if (existsSync(pkg) || existsSync(py)) {
        const sizeHint = existsSync(join(root, "src")) || existsSync(join(root, "lib"))
        if (sizeHint) {
          out.push({
            id: "no-constitution",
            severity: "low",
            category: "polish",
            title: "No project constitution yet",
            detail: "Coding standards not generated — agents may drift on style",
            action: "studio_constitution generate once; it auto-injects forever after",
          })
        }
      }
    } catch {
      /* ignore */
    }
  }
}

function collectCiFindings(out: ScoutFinding[]): void {
  const ci = getCISummary()
  if (ci && /fail/i.test(ci)) {
    out.push({
      id: "ci-fail",
      severity: "high",
      category: "verify",
      title: "CI failing",
      detail: ci.slice(0, 200),
      action: "studio_ci status, then fix with @studio-implement → studio_verify",
    })
  }
}

function rankFindings(findings: ScoutFinding[]): ScoutFinding[] {
  const weight: Record<ScoutSeverity, number> = { high: 0, medium: 1, low: 2 }
  const seen = new Set<string>()
  return findings
    .filter((f) => {
      if (seen.has(f.id)) return false
      seen.add(f.id)
      return true
    })
    .sort((a, b) => weight[a.severity] - weight[b.severity])
}

/** Context block for discipline injection. Null when autonomy is off or nothing found. */
export function scoutContextBlock(root = getActiveDirectory()): string | null {
  const mode = getAutonomyMode()
  if (mode === "off") return null

  const findings = runScout(root, mode === "full" ? 8 : 5)
  if (!findings.length) return null

  const lines = [
    "[studio scout] Autonomous improvement opportunities (opt out: studio_preferences set_autonomy off, or say \"don't scout\"):",
  ]
  for (const f of findings) {
    lines.push(`- [${f.severity}/${f.category}] ${f.title}: ${f.detail}`)
    lines.push(`  → ${f.action}`)
  }
  if (mode === "suggest") {
    lines.push("Mode=suggest: surface these; only act on high severity or when idle unless user asks.")
  } else {
    const created = materializeAutoActTasks(findings)
    if (created.length) {
      lines.push(
        `Mode=full auto-act: created ${created.length} task(s): ${created.map((t) => t.title).join("; ")}`,
      )
    }
    const top = findings.find((f) => f.severity === "high") ?? findings.find((f) => f.severity === "medium")
    if (top) {
      lines.push(
        `Mode=full MANDATORY NEXT (verify-first): @studio-implement — ${top.action} then studio_verify. ` +
          `Do this before new feature work. Ask before large refactors.`,
      )
    } else {
      lines.push("Mode=full: when idle, proactively fix medium/low items (tests+verify first). Ask before large refactors.")
    }
  }
  return lines.join("\n")
}

const SCOUT_TASK_TAG = /^\[scout:([^\]]+)\]\s*/

/**
 * When autonomy=full, turn high (and top medium) findings into studio_tasks
 * so the board + agent both have concrete work — not just prompt text.
 * Idempotent: skips findings that already have an open scout-tagged task.
 */
export function materializeAutoActTasks(findings: ScoutFinding[]): Array<{ id: string; title: string }> {
  const open = incompleteTasks()
  const existingIds = new Set(
    open
      .map((t) => t.title.match(SCOUT_TASK_TAG)?.[1])
      .filter((id): id is string => Boolean(id)),
  )

  const actionable = findings.filter(
    (f) => f.severity === "high" || (f.severity === "medium" && f.category !== "polish"),
  )
  const created: Array<{ id: string; title: string }> = []
  for (const f of actionable.slice(0, 3)) {
    if (existingIds.has(f.id)) continue
    const title = `[scout:${f.id}] ${f.title}`.slice(0, 500)
    const task = createTask(title, [
      f.detail.slice(0, 400),
      `Action: ${f.action}`,
      "Verify-first: implement → studio_verify before handoff",
      `scout-id:${f.id}`,
    ])
    created.push({ id: task.id, title: task.title })
    existingIds.add(f.id)
    log.info(`Auto-act task created: ${task.title}`)
  }
  return created
}

/** Detect natural-language autonomy opt-out / opt-in from user chat. */
export function detectAutonomyIntent(text: string): AutonomyMode | null {
  const t = text.toLowerCase()
  if (
    /\b(don'?t scout|no scout|stop scout|disable scout|no autonomy|turn off autonomy|stop suggesting(?: improvements)?|don'?t (?:be )?proactive|leave me alone)\b/.test(t)
  ) {
    return "off"
  }
  if (/\b(full autonomy|be proactive|autonomy on|enable scout|scout on|autonomous mode)\b/.test(t)) {
    return "full"
  }
  if (/\b(suggest only|suggestions only|autonomy suggest)\b/.test(t)) {
    return "suggest"
  }
  return null
}

/** Format scout findings for the studio_scout tool. */
export function formatScoutReport(findings: ScoutFinding[], mode: AutonomyMode): string {
  if (!findings.length) {
    return `Autonomy=${mode}. No improvement opportunities found right now. Run studio_verify or continue feature work.`
  }
  const lines = [`# Studio Scout (autonomy=${mode})`, ""]
  for (const f of findings) {
    lines.push(`## [${f.severity}] ${f.title}`)
    lines.push(f.detail)
    lines.push(`**Next:** ${f.action}`)
    lines.push("")
  }
  lines.push("Create tasks with studio_task for anything you will act on. Always studio_verify before handoff.")
  return lines.join("\n")
}

/** Cheap repo size signal for tests — not used in prod path. */
export function _countCodeFiles(root: string, limit = 200): number {
  let n = 0
  const walk = (dir: string) => {
    if (n >= limit) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git" || name === "dist" || name === ".studio") continue
      const p = join(dir, name)
      try {
        const st = statSync(p)
        if (st.isDirectory()) walk(p)
        else if (CODE_EXTS.has(extname(name))) n++
      } catch {
        /* skip */
      }
    }
  }
  walk(root)
  return n
}
