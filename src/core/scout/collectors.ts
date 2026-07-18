import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { basename, dirname, extname, join, relative } from "path"
import { spawnSync } from "child_process"
import { getDiagnosticsSummary, getDiagnostics } from "../diagnostics"
import { getWorkingSet } from "../passive-context"
import { incompleteTasks, listTasks } from "../workspace-tasks"
import { getActivePlan } from "../workspace-plans"
import { getVerifyState, getVerifyRetryHint } from "../workspace-verify"
import { loadProjectProfile } from "../project-profile"
import { findHotspots } from "../code-query"
import { getCISummary } from "../ci-watcher"
import { constitutionContextBlock } from "../constitution"
import * as log from "../logger"
import type { ScoutFinding } from "./types"

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".rb", ".php",
  ".swift", ".kt", ".cs", ".c", ".cpp", ".h",
])

const TEST_HINTS = /(?:\.test\.|\.spec\.|_test\.|_spec\.|\/tests?\/|\/__tests__\/|test_)/i

export function collectVerifyFindings(out: ScoutFinding[], _root: string): void {
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

export function collectDiagnosticFindings(out: ScoutFinding[], root: string): void {
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

export function collectTestGapFindings(out: ScoutFinding[], root: string): void {
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
  try {
    const siblings = readdirSync(dir)
    if (siblings.some((s) => TEST_HINTS.test(s) && s.includes(base))) return false
  } catch {
    /* ignore */
  }
  return true
}

export function collectTaskFindings(out: ScoutFinding[]): void {
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

export function collectPlanFindings(out: ScoutFinding[]): void {
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

export function collectHotspotFindings(out: ScoutFinding[], root: string): void {
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

export function collectProcessFindings(out: ScoutFinding[], root: string): void {
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

export function collectCiFindings(out: ScoutFinding[]): void {
  const ci = getCISummary()
  if (ci && /fail/i.test(ci)) {
    out.push({
      id: "ci-fail",
      severity: "high",
      category: "verify",
      title: "CI failing",
      detail: ci.slice(0, 200),
      action: "studio_ci triage, then fix with @studio-implement → studio_verify",
    })
  }
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".studio", "coverage", ".next", "vendor"])
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])

/** Cheap sync walk of project source (skips node_modules / build dirs). */
function walkSrcFiles(root: string, limit = 400): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (out.length >= limit) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue
      const p = join(dir, name)
      try {
        const st = statSync(p)
        if (st.isDirectory()) walk(p)
        else if (SCAN_EXTS.has(extname(name))) out.push(p)
      } catch {
        /* skip */
      }
    }
  }
  const prefer = ["src", "lib", "app"].map((d) => join(root, d)).filter((d) => existsSync(d))
  if (prefer.length) {
    for (const d of prefer) walk(d)
  } else {
    walk(root)
  }
  return out
}

/**
 * Security heuristics: tracked .env files, eval( in src, shell:true child_process.
 * Exported for unit tests.
 */
export function collectSecurityFindings(out: ScoutFinding[], root: string): void {
  try {
    const ls = spawnSync("git", ["ls-files", "--", ".env", ".env.local", ".env.production", ".env.development"], {
      cwd: root,
      encoding: "utf-8",
      timeout: 5_000,
    })
    if (ls.status === 0 && ls.stdout.trim()) {
      const tracked = ls.stdout.trim().split("\n").filter(Boolean)
      if (tracked.length) {
        out.push({
          id: "sec-env-tracked",
          severity: "high",
          category: "security",
          title: `${tracked.length} env file(s) tracked by git`,
          detail: tracked.slice(0, 5).join(", "),
          action: "Remove from git (git rm --cached), add to .gitignore, rotate any leaked secrets",
        })
      }
    }
  } catch (err) {
    log.debugCatch("scout.security.env", err)
  }

  const evalHits: string[] = []
  const shellHits: string[] = []
  for (const file of walkSrcFiles(root)) {
    let text: string
    try {
      text = readFileSync(file, "utf-8")
    } catch {
      continue
    }
    const rel = relative(root, file)
    if (/(?:^|[^.\w])eval\s*\(/.test(text)) {
      evalHits.push(rel)
    }
    if (
      /(?:child_process|spawn|exec|execFile|spawnSync|execSync)/.test(text) &&
      /shell\s*:\s*true/.test(text)
    ) {
      shellHits.push(rel)
    }
  }

  if (evalHits.length) {
    out.push({
      id: "sec-eval",
      severity: "high",
      category: "security",
      title: `eval() found in ${evalHits.length} source file(s)`,
      detail: evalHits.slice(0, 4).join(", "),
      action: "Replace eval with safe parsing/APIs; never eval untrusted input",
    })
  }
  if (shellHits.length) {
    out.push({
      id: "sec-shell-true",
      severity: "medium",
      category: "security",
      title: `child_process shell:true in ${shellHits.length} file(s)`,
      detail: shellHits.slice(0, 4).join(", "),
      action: "Prefer spawn(cmd, args, {shell:false}); avoid shell interpolation of untrusted input",
    })
  }
}

/** Known high-severity / abandoned packages worth a cheap local flag (no network). */
const RISKY_DEPS = new Set([
  "event-stream",
  "flatmap-stream",
  "node-ipc",
  "ua-parser-js",
])

/**
 * Cheap deps heuristics: missing lockfile, wildcard ranges, known-risky names.
 * No network — studio_deps audit remains the deep path.
 * Exported for unit tests.
 */
export function collectDepsFindings(out: ScoutFinding[], root: string): void {
  const pkgPath = join(root, "package.json")
  if (!existsSync(pkgPath)) return

  const lockfiles = [
    "package-lock.json",
    "bun.lock",
    "bun.lockb",
    "yarn.lock",
    "pnpm-lock.yaml",
    "npm-shrinkwrap.json",
  ]
  const hasLock = lockfiles.some((f) => existsSync(join(root, f)))
  if (!hasLock) {
    out.push({
      id: "deps-no-lockfile",
      severity: "medium",
      category: "deps",
      title: "package.json present but no lockfile",
      detail: "Missing package-lock.json / bun.lock / yarn.lock / pnpm-lock.yaml",
      action: "Commit a lockfile for reproducible installs; then studio_deps audit",
    })
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    const wildcards: string[] = []
    const risky: string[] = []
    for (const [name, version] of Object.entries(all)) {
      if (version === "*" || version === "latest" || version === "x") {
        wildcards.push(`${name}@${version}`)
      }
      if (RISKY_DEPS.has(name)) {
        risky.push(`${name}@${version}`)
      }
    }
    if (risky.length) {
      out.push({
        id: "deps-risky",
        severity: "high",
        category: "deps",
        title: `${risky.length} historically risky package(s)`,
        detail: risky.slice(0, 5).join(", "),
        action: "studio_deps audit; remove or pin safe versions of compromised packages",
      })
    } else if (wildcards.length) {
      out.push({
        id: "deps-wildcard",
        severity: "low",
        category: "deps",
        title: `${wildcards.length} wildcard / floating dependency range(s)`,
        detail: wildcards.slice(0, 5).join(", "),
        action: "Pin semver ranges and regenerate lockfile; studio_deps outdated for updates",
      })
    }
  } catch (err) {
    log.debugCatch("scout.deps", err)
  }
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
