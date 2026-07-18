import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  checkCIStatus,
  startCIWatcher,
  stopCIWatcher,
  getCISummary,
  isGhAvailable,
  triageFailedCI,
  formatTriageReport,
} from "../core/ci-watcher"
import { getActiveDirectory } from "../core/active-dir"

export const studio_ci: ToolDefinition = tool({
  description:
    "GitHub Actions CI watcher — check status, triage failing runs (logs + root cause + optional tasks), " +
      "start/stop background monitoring (30s). Requires gh CLI authenticated.",
  args: {
    action: tool.schema
      .enum(["status", "triage", "start", "stop", "summary"])
      .describe(
        "status=check CI now | triage=fetch failed logs + root cause (+ [ci:runId] tasks) | start=begin watching | stop=stop | summary=cached status",
      ),
  },
  async execute(args) {
    const cwd = getActiveDirectory()

    switch (args.action) {
      case "status": {
        const available = await isGhAvailable(cwd)
        if (!available) return "gh CLI not available or not authenticated. Run `gh auth login` first."
        const status = await checkCIStatus(cwd)
        if (status.failingWorkflows.length === 0 && !status.hasActiveRuns) {
          return "✓ CI is green — no failing workflows."
        }
        const summary = getCISummary()
        return summary ?? "CI status unknown."
      }

      case "triage": {
        const report = await triageFailedCI(cwd, { createTasks: true })
        return formatTriageReport(report)
      }

      case "start": {
        const started = await startCIWatcher(cwd)
        return started
          ? "CI watcher started (30s interval). Failing workflows will be injected into session context."
          : "gh CLI not available or not authenticated. Run `gh auth login` first."
      }

      case "stop": {
        stopCIWatcher()
        return "CI watcher stopped."
      }

      case "summary": {
        const summary = getCISummary()
        return summary ?? "No CI status cached yet. Run studio_ci action=status first."
      }

      default:
        return `Unknown action: ${args.action}`
    }
  },
})
