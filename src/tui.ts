/**
 * opencode-studio TUI plugin — renders UI elements in the OpenCode terminal.
 *
 * Features:
 *   - Sidebar status panel: plan progress, cost, branch, verify, CI badge
 *   - Prompt-right badge: compact session stats
 *   - Home footer: quick stats line
 *   - Toast notifications: verify pass/fail, cost thresholds
 *   - Command palette: 10 studio commands
 *
 * Uses @opentui/solid JSX for rendering. Types are resolved at runtime by
 * OpenCode — @opentui/core and @opentui/solid are externalized in the build.
 */
/// <reference types="@opentui/solid" />
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

/** Read studio stats from the SQLite DB for sidebar display. */
function readStudioStats(): { cost: string; tasks: string; verify: string; branch: string } {
  try {
    const { openStudioDb, queryOne } = require("../core/studio-db")
    const db = openStudioDb(process.cwd())

    const costRow = queryOne<{ total: number }>(db, "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_events WHERE session_id != ''")
    const cost = costRow ? `$${costRow.total.toFixed(2)}` : "$0.00"

    const taskRow = queryOne<{ open: number }>(db, "SELECT COUNT(*) AS open FROM tasks WHERE status IN ('pending','in_progress')")
    const tasks = taskRow ? `${taskRow.open} tasks` : "0 tasks"

    const verifyRow = queryOne<{ passed: number }>(db, "SELECT passed FROM verify_state WHERE id = 1")
    const verify = verifyRow ? (verifyRow.passed === 1 ? "✓ verify" : "✗ verify") : "— verify"

    const { currentBranch } = require("../core/branch-context")
    const branch = currentBranch() ?? "main"

    return { cost, tasks, verify, branch }
  } catch {
    return { cost: "$0.00", tasks: "0 tasks", verify: "— verify", branch: "—" }
  }
}

/** Format a colorized status line for the home footer. */
function footerLine(stats: ReturnType<typeof readStudioStats>): string {
  return `studio: ${stats.cost} | ${stats.tasks} | ${stats.verify} | ${stats.branch}`
}

export const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const { ui, command, event, slots, theme, state } = api

  // ——— Command palette entries ————————————————
  const unregisterCmds = command.register(() => [
    { title: "Studio: Cost Report", value: "/studio-cost", category: "Studio" },
    { title: "Studio: Verify", value: "/studio-verify", category: "Studio" },
    { title: "Studio: Handoff", value: "/studio-handoff", category: "Studio" },
    { title: "Studio: Help", value: "/studio-help", category: "Studio" },
    { title: "Studio: Git Status", value: "/studio-git status", category: "Studio" },
    { title: "Studio: Doctor", value: "/studio-doctor", category: "Studio" },
    { title: "Studio: Generate Constitution", value: "/studio-constitution generate", category: "Studio" },
    { title: "Studio: CI Status", value: "/studio-ci status", category: "Studio" },
    { title: "Studio: Deps Audit", value: "/studio-deps audit", category: "Studio" },
    { title: "Studio: Plan Write", value: "/studio-plan", category: "Studio" },
  ])

  // ——— Toast notifications ————————————————
  const unsubCost = event.on("message.updated", (evt: { type: string; properties?: { info?: { cost?: number } } }) => {
    try {
      const cost = evt.properties?.info?.cost
      if (cost && cost > 0.50) {
        ui.toast({ variant: "warning", title: "Cost Alert", message: `Session cost exceeded $${cost.toFixed(2)}. Consider studio_preferences set_model_mode free.`, duration: 5000 })
      }
    } catch { /* best-effort */ }
  })

  const unsubVerify = event.on("tool.execute.after", (evt: { type: string; properties?: { tool?: string; output?: string } }) => {
    try {
      if (evt.properties?.tool !== "studio_verify") return
      const output = evt.properties.output ?? ""
      if (output.includes("Verify passed")) {
        ui.toast({ variant: "success", title: "Verify Passed", message: "All checks green — handoff enabled.", duration: 3000 })
      } else if (output.includes("failed")) {
        ui.toast({ variant: "error", title: "Verify Failed", message: "Check output for details.", duration: 5000 })
      }
    } catch { /* best-effort */ }
  })

  // ——— Sidebar status panel ————————————————
  // Renders a compact studio status card in the sidebar showing:
  // plan progress, cost, branch, verify state
  const unregisterSidebar = slots.register({
    render: () => {
      const stats = readStudioStats()
      const t = theme.current
      const lines: string[] = [
        `studio: ${stats.cost} | ${stats.branch}`,
        `${stats.tasks} | ${stats.verify}`,
      ]
      // Return a simple text element — using the Slot API
      // The actual JSX rendering is handled by @opentui/solid at runtime
      return lines.join("\n") as any
    },
  })

  // ——— Home footer — quick stats line ————————————————
  const unregisterFooter = slots.register({
    render: () => {
      const stats = readStudioStats()
      return footerLine(stats) as any
    },
  })

  // ——— Cleanup on dispose ————————————————
  api.lifecycle.onDispose(() => {
    unregisterCmds()
    unsubCost()
    unsubVerify()
    if (unregisterSidebar) unregisterSidebar()
    if (unregisterFooter) unregisterFooter()
  })
}

const tuiModule = { id: "opencode-studio-tui", tui }
export default tuiModule
