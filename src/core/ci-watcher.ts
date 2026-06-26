/**
 * Always-on PR/CI watcher — polls GitHub Actions status via `gh` CLI.
 *
 * Checks for CI failures and injects them into the session context so the
 * agent knows if CI is broken. Runs on a 30s interval when active.
 */
import { spawn } from "child_process"
import * as log from "./logger"

/** Run a shell command, returning trimmed stdout. */
function shell(cmd: string, cwd: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, { cwd, shell: true, timeout: timeoutMs })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `${cmd} failed`))
    })
  })
}

export interface CIStatus {
  hasActiveRuns: boolean
  failingWorkflows: Array<{ name: string; conclusion: string; url: string }>
  pendingRuns: number
  lastChecked: number
}

let watcherInterval: ReturnType<typeof setInterval> | null = null
let lastStatus: CIStatus | null = null

const POLL_INTERVAL_MS = 30_000

/** Check if gh CLI is available and authenticated. */
export async function isGhAvailable(cwd: string): Promise<boolean> {
  try {
    await shell("gh auth status", cwd, 5_000)
    return true
  } catch {
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
    // Get the latest run for each workflow.
    const out = await shell(
      `gh run list --limit 10 --json name,status,conclusion,url --jq '.[] | "|\\(.name)|\\(.status)|\\(.conclusion)|\\(.url)"'`,
      cwd,
      10_000,
    )

    for (const line of out.split("\n")) {
      if (!line.startsWith("|")) continue
      const [, name, runStatus, conclusion, url] = line.split("|")
      if (runStatus === "in_progress" || runStatus === "queued") {
        status.hasActiveRuns = true
        status.pendingRuns++
      } else if (runStatus === "completed" && conclusion === "failure") {
        status.failingWorkflows.push({ name, conclusion, url })
      }
    }
  } catch {
    /* gh CLI not available or not a GitHub repo */
  }

  lastStatus = status
  return status
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
