/**
 * Always-on PR/CI watcher — polls GitHub Actions status via `gh` CLI.
 *
 * Checks for CI failures and injects them into the session context so the
 * agent knows if CI is broken. Runs on a 30s interval when active.
 *
 * Also provides Bugbot-class triage: fetch failed-run logs, extract likely
 * root cause, and optionally materialize idempotent `[ci:runId]` tasks.
 */
import { spawn } from "child_process"
import { incompleteTasks, createTask } from "./workspace-tasks"
import * as log from "./logger"

const LOG_TRUNCATE = 6_000
const CI_TASK_TAG = /^\[ci:([^\]]+)\]\s*/

/** Run `gh` with argv (no shell). */
export function gh(args: string[], cwd: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args, { cwd, shell: false, timeout: timeoutMs })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `gh ${args.join(" ")} failed`))
    })
  })
}

export interface CIStatus {
  hasActiveRuns: boolean
  failingWorkflows: Array<{ name: string; conclusion: string; url: string }>
  pendingRuns: number
  lastChecked: number
}

export interface CITriageItem {
  runId: string
  name: string
  conclusion: string
  url: string
  headBranch: string
  rootCause: string
  logExcerpt: string
}

export interface CITriageReport {
  available: boolean
  failingCount: number
  items: CITriageItem[]
  tasksCreated: Array<{ id: string; title: string }>
  error?: string
}

let watcherInterval: ReturnType<typeof setInterval> | null = null
let lastStatus: CIStatus | null = null

const POLL_INTERVAL_MS = 30_000

/** Check if gh CLI is available and authenticated. */
export async function isGhAvailable(cwd: string): Promise<boolean> {
  try {
    await gh(["auth", "status"], cwd, 5_000)
    return true
  } catch (err) {
    log.debugCatch("src/core/ci-watcher.ts", err)
    return false
  }
}

/** Query the latest CI run status via gh CLI. */
export async function checkCIStatus(cwd: string): Promise<CIStatus> {
  const status: CIStatus = {
    hasActiveRuns: false,
    failingWorkflows: [],
    pendingRuns: 0,
    lastChecked: Date.now(),
  }

  try {
    const out = await gh(
      ["run", "list", "--limit", "10", "--json", "name,status,conclusion,url"],
      cwd,
      10_000,
    )
    const runs = JSON.parse(out || "[]") as Array<{
      name: string
      status: string
      conclusion: string | null
      url: string
    }>

    for (const run of runs) {
      if (run.status === "in_progress" || run.status === "queued") {
        status.hasActiveRuns = true
        status.pendingRuns++
      } else if (run.status === "completed" && run.conclusion === "failure") {
        status.failingWorkflows.push({
          name: run.name,
          conclusion: run.conclusion,
          url: run.url,
        })
      }
    }
  } catch (err) {
    log.debugCatch("src/core/ci-watcher.ts", err)
  }

  lastStatus = status
  return status
}

/**
 * Truncate CI logs to ~6k chars, preferring the tail (where failures usually appear).
 * Exported for unit tests.
 */
export function truncateLog(logText: string, max = LOG_TRUNCATE): string {
  if (logText.length <= max) return logText
  const tail = logText.slice(-max)
  return `…[truncated ${logText.length - max} chars]…\n${tail}`
}

/**
 * Extract a likely root-cause snippet from failed CI logs.
 * Looks for jest / pytest / tsc / generic error patterns, else last error-ish lines.
 * Exported for unit tests.
 */
export function extractRootCause(logText: string): string {
  const lines = logText.split(/\r?\n/)
  const patterns: RegExp[] = [
    /error TS\d+:/i,
    /\bFAIL\b.+\.(?:test|spec)\.[jt]sx?/i,
    /●\s+.+/,
    /\bFAILED\b.+(?:\[|::)/,
    /E\s{2,}.+/,
    /AssertionError/,
    /Expected:|Received:/,
    /TypeError:|ReferenceError:|SyntaxError:/,
    /Error:\s+\S.+/,
    /\berror:\s+\S.+/i,
    /Process completed with exit code [1-9]/,
  ]

  const hits: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (patterns.some((p) => p.test(line))) {
      const ctx = lines
        .slice(Math.max(0, i - 1), Math.min(lines.length, i + 3))
        .map((l) => l.trimEnd())
        .filter(Boolean)
      hits.push(ctx.join("\n"))
    }
  }

  if (hits.length) {
    // Prefer the last cluster — usually the failing step's actual error.
    return hits[hits.length - 1]!.slice(0, 800)
  }

  const errorish = lines.filter((l) => /error|fail|exception|fatal/i.test(l) && l.trim().length > 0)
  if (errorish.length) {
    return errorish.slice(-8).join("\n").slice(0, 800)
  }

  return lines.filter((l) => l.trim()).slice(-6).join("\n").slice(0, 800) || "Unable to extract root cause from logs"
}

interface GhRunRow {
  databaseId: number
  name: string
  status: string
  conclusion: string | null
  url: string
  headBranch?: string
  displayTitle?: string
}

/**
 * Triage failing CI runs: list failures, fetch `--log-failed`, truncate, extract root cause.
 * Optionally creates idempotent `[ci:runId]` tasks for high (all CI) failures.
 */
export async function triageFailedCI(
  cwd: string,
  opts: { createTasks?: boolean } = {},
): Promise<CITriageReport> {
  const createTasks = opts.createTasks !== false
  const report: CITriageReport = {
    available: false,
    failingCount: 0,
    items: [],
    tasksCreated: [],
  }

  try {
    await gh(["auth", "status"], cwd, 5_000)
  } catch (err) {
    report.error = "gh CLI not available or not authenticated"
    log.debugCatch("ci-watcher.triage.auth", err)
    return report
  }
  report.available = true

  let runs: GhRunRow[] = []
  try {
    const out = await gh(
      [
        "run",
        "list",
        "--limit",
        "20",
        "--json",
        "databaseId,name,status,conclusion,url,headBranch,displayTitle",
      ],
      cwd,
      15_000,
    )
    runs = JSON.parse(out || "[]") as GhRunRow[]
  } catch (err) {
    report.error = `Failed to list runs: ${(err as Error).message}`
    log.debugCatch("ci-watcher.triage.list", err)
    return report
  }

  const failing = runs.filter((r) => r.status === "completed" && r.conclusion === "failure")
  report.failingCount = failing.length

  // Deduplicate by workflow name — keep newest (list is newest-first).
  const seenNames = new Set<string>()
  const toTriage: GhRunRow[] = []
  for (const run of failing) {
    if (seenNames.has(run.name)) continue
    seenNames.add(run.name)
    toTriage.push(run)
    if (toTriage.length >= 5) break
  }

  for (const run of toTriage) {
    const runId = String(run.databaseId)
    let logText = ""
    try {
      logText = await gh(["run", "view", runId, "--log-failed"], cwd, 60_000)
    } catch (err) {
      logText = `Failed to fetch logs: ${(err as Error).message}`
      log.debugCatch("ci-watcher.triage.log", err)
    }

    const excerpt = truncateLog(logText)
    const rootCause = extractRootCause(excerpt)
    report.items.push({
      runId,
      name: run.name,
      conclusion: run.conclusion ?? "failure",
      url: run.url,
      headBranch: run.headBranch ?? "",
      rootCause,
      logExcerpt: excerpt,
    })
  }

  if (createTasks && report.items.length) {
    report.tasksCreated = materializeCiTasks(report.items)
  }

  return report
}

/**
 * Create `[ci:runId]` tasks for triage items. Idempotent — skips runIds that
 * already have an open CI-tagged task (same pattern as scout).
 */
export function materializeCiTasks(items: CITriageItem[]): Array<{ id: string; title: string }> {
  const open = incompleteTasks()
  const existingIds = new Set(
    open
      .map((t) => t.title.match(CI_TASK_TAG)?.[1])
      .filter((id): id is string => Boolean(id)),
  )

  const created: Array<{ id: string; title: string }> = []
  for (const item of items.slice(0, 5)) {
    if (existingIds.has(item.runId)) continue
    const title = `[ci:${item.runId}] Fix failing CI: ${item.name}`.slice(0, 500)
    const task = createTask(title, [
      item.rootCause.slice(0, 400),
      `URL: ${item.url}`,
      item.headBranch ? `Branch: ${item.headBranch}` : "",
      "Action: studio_ci triage → fix → studio_verify",
      `ci-run:${item.runId}`,
    ].filter(Boolean))
    created.push({ id: task.id, title: task.title })
    existingIds.add(item.runId)
    log.info(`CI triage task created: ${task.title}`)
  }
  return created
}

/** Format a triage report for the studio_ci tool. */
export function formatTriageReport(report: CITriageReport): string {
  if (!report.available) {
    return report.error ?? "gh CLI not available or not authenticated. Run `gh auth login` first."
  }
  if (report.error && !report.items.length) {
    return report.error
  }
  if (!report.failingCount) {
    return "✓ No failing CI runs found."
  }

  const lines = [
    `# CI Triage (${report.items.length} of ${report.failingCount} failing run(s))`,
    "",
  ]
  for (const item of report.items) {
    lines.push(`## ${item.name} (run ${item.runId})`)
    if (item.headBranch) lines.push(`Branch: ${item.headBranch}`)
    lines.push(`URL: ${item.url}`)
    lines.push("")
    lines.push("**Likely root cause:**")
    lines.push("```")
    lines.push(item.rootCause)
    lines.push("```")
    lines.push("")
  }
  if (report.tasksCreated.length) {
    lines.push(
      `Created ${report.tasksCreated.length} task(s): ${report.tasksCreated.map((t) => t.title).join("; ")}`,
    )
  }
  lines.push("Next: fix root cause → studio_verify → re-check with studio_ci status.")
  return lines.join("\n")
}

/** Start the background CI watcher. */
export async function startCIWatcher(cwd: string): Promise<boolean> {
  if (watcherInterval) return true
  const available = await isGhAvailable(cwd)
  if (!available) return false

  // Do an immediate check.
  await checkCIStatus(cwd)

  watcherInterval = setInterval(async () => {
    try {
      await checkCIStatus(cwd)
    } catch (err) {
      log.error(`CI watcher error: ${(err as Error).message}`)
    }
  }, POLL_INTERVAL_MS)
  watcherInterval.unref?.()

  log.info("CI watcher started (30s interval)")
  return true
}

/** Stop the background CI watcher. */
export function stopCIWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval)
    watcherInterval = null
    log.info("CI watcher stopped")
  }
}

/** Get the latest CI status for injection into session context. */
export function getCISummary(): string | null {
  if (!lastStatus) return null
  if (!lastStatus.failingWorkflows.length && !lastStatus.hasActiveRuns) return null

  const lines: string[] = ["[studio ci] GitHub Actions status:"]
  if (lastStatus.hasActiveRuns) {
    lines.push(`  ⏳ ${lastStatus.pendingRuns} run(s) in progress`)
  }
  if (lastStatus.failingWorkflows.length) {
    lines.push(`  ❌ ${lastStatus.failingWorkflows.length} failing:`)
    for (const f of lastStatus.failingWorkflows.slice(0, 5)) {
      lines.push(`    ${f.name} — ${f.url}`)
    }
  }
  return lines.join("\n")
}
