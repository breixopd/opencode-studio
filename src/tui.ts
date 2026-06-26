/**
 * opencode-studio TUI plugin — comprehensive UI suite for the OpenCode terminal.
 *
 * The user should ALWAYS know what's happening:
 *   - Subagent retry/error (session.status, session.error)
 *   - Rule auto-captured (rules table change detection)
 *   - LSP diagnostics changes (new errors / cleared)
 *   - Verify pass/fail (tool.execute.after)
 *   - Cost thresholds exceeded
 *   - Branch switches (vcs.branch.updated)
 *   - Permission requests (permission.asked)
 *   - Command executions (command.executed)
 *   - File edits to studio-managed files (CONSTITUTION.md, MEMORY.md, AGENTS.md)
 *
 * Plus:
 *   - /studio dashboard route (full-screen stats)
 *   - Sidebar with live stats + LSP status
 *   - Home footer stats
 *   - Command palette with 11 commands
 *   - KV-controlled toast toggle (studio.toasts.enabled)
 *   - KV-controlled sidebar visibility (studio.sidebar.visible)
 */
/// <reference types="@opentui/solid" />
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

// ——— Studio stats reader ————————————————————————————————

interface StudioStats {
  cost: string
  costByModel: Array<{ model: string; cost: number }>
  tasksOpen: number
  tasksDone: number
  verify: string
  branch: string
  planTitle: string | null
  diagnostics: number
}

function readStats(): StudioStats {
  try {
    const { openStudioDb, queryAll, queryOne } = require("../core/studio-db")
    const db = openStudioDb(process.cwd())

    const totalCost = queryOne<{ t: number }>(db, "SELECT COALESCE(SUM(cost_usd), 0) AS t FROM cost_events")?.t ?? 0
    const byModel = queryAll<{ model_id: string; cost: number }>(
      db, "SELECT model_id, COALESCE(SUM(cost_usd), 0) AS cost FROM cost_events GROUP BY model_id ORDER BY cost DESC LIMIT 5",
    )
    const taskOpen = queryOne<{ c: number }>(db, "SELECT COUNT(*) AS c FROM tasks WHERE status IN ('pending','in_progress')")?.c ?? 0
    const taskDone = queryOne<{ c: number }>(db, "SELECT COUNT(*) AS c FROM tasks WHERE status = 'done'")?.c ?? 0
    const verifyRow = queryOne<{ passed: number }>(db, "SELECT passed FROM verify_state WHERE id = 1")
    const verify = verifyRow ? (verifyRow.passed === 1 ? "✓" : "✗") : "—"
    const planRow = queryOne<{ title: string }>(db, "SELECT title FROM plans WHERE active = 1 LIMIT 1")
    const diagCount = queryOne<{ c: number }>(db, "SELECT COUNT(*) AS c FROM diagnostics WHERE severity = 'error'")?.c ?? 0

    let branch = "—"
    try { branch = require("../core/branch-context").currentBranch() ?? "main" } catch { /* not git */ }

    return {
      cost: `$${totalCost.toFixed(4)}`,
      costByModel: byModel.map((m) => ({ model: m.model_id, cost: m.cost })),
      tasksOpen: taskOpen,
      tasksDone: taskDone,
      verify,
      branch,
      planTitle: planRow?.title ?? null,
      diagnostics: diagCount,
    }
  } catch {
    return { cost: "$0", costByModel: [], tasksOpen: 0, tasksDone: 0, verify: "—", branch: "—", planTitle: null, diagnostics: 0 }
  }
}

// ——— TUI Plugin ————————————————————————————————

export const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const { ui, command, event, slots, theme, state, kv, route, lifecycle } = api

  const prev = { verifyPassed: false, diagCount: 0, branch: "", ruleCount: 0 }
  const cleanups: Array<() => void> = []

  // ——— /studio dashboard route ————————————————————————
  cleanups.push(route.register([
    {
      name: "studio",
      render: () => {
        const s = readStats()
        const lines: string[] = [
          "╔══════════════════════════════════════════╗",
          "║          STUDIO DASHBOARD                  ║",
          "╚══════════════════════════════════════════╝",
          "",
          `  Branch:      ${s.branch}`,
          `  Plan:        ${s.planTitle ?? "(none active)"}`,
          `  Verify:      ${s.verify}`,
          `  Tasks:       ${s.tasksDone} done / ${s.tasksOpen} open`,
          `  Cost:        ${s.cost}`,
          `  Type errors: ${s.diagnostics}`,
          "",
        ]
        if (s.costByModel.length > 0) {
          lines.push("  Cost by model:")
          for (const m of s.costByModel) lines.push(`    ${m.model}: $${m.cost.toFixed(4)}`)
          lines.push("")
        }
        lines.push("  Quick commands:")
        lines.push("    /studio-cost     /studio-verify     /studio-handoff")
        lines.push("    /studio-git status   /studio-doctor   /studio-deps audit")
        return lines.join("\n") as any
      },
    },
  ]))

  // ——— Command palette ————————————————————————
  cleanups.push(command.register(() => [
    { title: "Studio: Dashboard", value: "/studio", category: "Studio", slash: { name: "studio" } },
    { title: "Studio: Cost Report", value: "/studio-cost", category: "Studio" },
    { title: "Studio: Verify", value: "/studio-verify", category: "Studio" },
    { title: "Studio: Handoff", value: "/studio-handoff", category: "Studio" },
    { title: "Studio: Help", value: "/studio-help", category: "Studio" },
    { title: "Studio: Git Status", value: "/studio-git status", category: "Studio" },
    { title: "Studio: Doctor", value: "/studio-doctor", category: "Studio" },
    { title: "Studio: Constitution", value: "/studio-constitution generate", category: "Studio" },
    { title: "Studio: CI Status", value: "/studio-ci status", category: "Studio" },
    { title: "Studio: Deps Audit", value: "/studio-deps audit", category: "Studio" },
    { title: "Studio: Plan Write", value: "/studio-plan", category: "Studio" },
  ]))

  // ——— Session retry → warning toast ————————————————
  cleanups.push(event.on("session.status", (evt: { type: string; properties: { sessionID: string; status: { type: string; attempt?: number; message?: string } } }) => {
    try {
      const { status } = evt.properties
      if (status.type === "retry") {
        ui.toast({ variant: "warning", title: "Retrying", message: `Attempt ${status.attempt}: ${status.message?.slice(0, 100) ?? ""}`, duration: 3000 })
      }
    } catch { /* best-effort */ }
  }))

  // ——— Session error → error toast ————————————————
  cleanups.push(event.on("session.error", (evt: { type: string; properties: { error?: { message?: string } } }) => {
    try {
      const msg = evt.properties?.error?.message ?? "Unknown error"
      ui.toast({ variant: "error", title: "Session Error", message: msg.slice(0, 150), duration: 5000 })
    } catch { /* best-effort */ }
  }))

  // ——— Subagent lifecycle tracking ————————————————
  // Track which messages have already been "completed" so we only toast once.
  const completedMessages = new Set<string>()
  // Track active agents per session for accurate "started" detection.
  const activeAgents = new Map<string, string>()

  cleanups.push(event.on("message.updated", (evt: { type: string; properties: { info?: { role?: string; agent?: string; sessionID?: string; id?: string; time?: { created?: number; completed?: number }; cost?: number; tokens?: { input: number; output: number }; finish?: string; error?: { message?: string }; modelID?: string; providerID?: string } } }) => {
    try {
      const info = evt.properties?.info
      if (!info) return

      // ——— Subagent started: UserMessage with agent field ————————————————
      if (info.role === "user" && info.agent && info.agent.startsWith("studio-")) {
        const agentName = info.agent.replace("studio-", "@studio-")
        activeAgents.set(info.sessionID ?? "", info.agent)
        ui.toast({ variant: "info", title: "Subagent Started", message: `${agentName} is working…`, duration: 2500 })
        return
      }

      // ——— Subagent completed: AssistantMessage with time.completed ————————————————
      if (info.role === "assistant" && info.time?.completed && info.id) {
        if (completedMessages.has(info.id)) return // already toasted
        completedMessages.add(info.id)

        // Determine which agent this was based on session tracking
        const sessionID = info.sessionID ?? ""
        const agentName = activeAgents.get(sessionID) ?? "agent"
        const display = agentName.startsWith("studio-") ? `@${agentName}` : agentName
        activeAgents.delete(sessionID)

        // Build completion message with cost + tokens
        const cost = info.cost ? ` $${info.cost.toFixed(4)}` : ""
        const tokens = info.tokens ? ` (${info.tokens.input + info.tokens.output} tokens)` : ""
        const finish = info.finish ? ` — ${info.finish}` : ""

        // Error completion
        if (info.error) {
          ui.toast({ variant: "error", title: `${display} Failed`, message: info.error.message?.slice(0, 120) ?? "Unknown error", duration: 5000 })
        } else {
          ui.toast({ variant: "success", title: `${display} Done`, message: `Completed${cost}${tokens}${finish}`, duration: 3000 })
        }

        // Cost threshold check (also on assistant messages)
        if (info.cost && info.cost > 0.50) {
          ui.toast({ variant: "warning", title: "Cost Alert", message: `Session cost exceeded $${info.cost.toFixed(2)}. Try studio_preferences set_model_mode free.`, duration: 5000 })
        }

        // Rule auto-capture detection (rules table count change)
        try {
          const { openStudioDb, queryOne } = require("../core/studio-db")
          const db = openStudioDb(process.cwd())
          const count = queryOne<{ c: number }>(db, "SELECT COUNT(*) AS c FROM rules")?.c ?? 0
          if (prev.ruleCount === 0) prev.ruleCount = count
          if (count > prev.ruleCount) {
            ui.toast({ variant: "info", title: "Rule Saved", message: `Auto-captured rule (now ${count} total).`, duration: 3000 })
            prev.ruleCount = count
          }
        } catch { /* db not ready */ }

        return
      }

      // ——— Cost threshold on non-completion messages too ————————————————
      if (info.cost && info.cost > 0.50) {
        ui.toast({ variant: "warning", title: "Cost Alert", message: `Session cost exceeded $${info.cost.toFixed(2)}. Try studio_preferences set_model_mode free.`, duration: 5000 })
      }
    } catch { /* best-effort */ }
  }))

  // ——— Tool after → verify pass/fail toast ————————————————
  cleanups.push(event.on("tool.execute.after", (evt: { type: string; properties: { tool?: string; output?: string } }) => {
    try {
      if (evt.properties?.tool !== "studio_verify") return
      const output = evt.properties.output ?? ""
      if (output.includes("Verify passed") && !prev.verifyPassed) {
        ui.toast({ variant: "success", title: "Verify Passed", message: "All checks green — handoff enabled.", duration: 3000 })
        prev.verifyPassed = true
      } else if (output.includes("failed")) {
        ui.toast({ variant: "error", title: "Verify Failed", message: "Fix issues and re-run studio_verify.", duration: 5000 })
        prev.verifyPassed = false
      }
    } catch { /* best-effort */ }
  }))

  // ——— Command executed → info toast for studio commands ————————————————
  cleanups.push(event.on("command.executed", (evt: { type: string; properties: { name?: string } }) => {
    try {
      const name = evt.properties?.name ?? ""
      if (name.startsWith("studio") || name.startsWith("/studio")) {
        ui.toast({ variant: "info", title: "Command", message: `Running: ${name}`, duration: 1500 })
      }
    } catch { /* best-effort */ }
  }))

  // ——— Git branch changed → toast ————————————————
  cleanups.push(event.on("vcs.branch.updated", (evt: { type: string; properties: { branch?: string } }) => {
    try {
      const branch = evt.properties?.branch
      if (branch && branch !== prev.branch) {
        ui.toast({ variant: "info", title: "Branch Switched", message: `Now on ${branch}`, duration: 2000 })
        prev.branch = branch
      }
    } catch { /* best-effort */ }
  }))

  // ——— LSP diagnostics changed → toast for new/cleared errors ————————————————
  cleanups.push(event.on("lsp.client.diagnostics", (evt: { type: string; properties: { path?: string } }) => {
    try {
      const { openStudioDb, queryOne } = require("../core/studio-db")
      const db = openStudioDb(process.cwd())
      const count = queryOne<{ c: number }>(db, "SELECT COUNT(*) AS c FROM diagnostics WHERE severity = 'error'")?.c ?? 0
      if (count > prev.diagCount) {
        ui.toast({ variant: "warning", title: "Type Error", message: `${count} error(s) in ${evt.properties?.path?.split("/").pop() ?? "file"}`, duration: 3000 })
      } else if (count < prev.diagCount && count === 0) {
        ui.toast({ variant: "success", title: "Type Errors Cleared", message: "All type errors resolved.", duration: 2000 })
      }
      prev.diagCount = count
    } catch { /* best-effort */ }
  }))

  // ——— File edited → toast for studio-managed files ————————————————
  cleanups.push(event.on("file.edited", (evt: { type: string; properties: { path?: string } }) => {
    try {
      const path = evt.properties?.path ?? ""
      if (path.includes("CONSTITUTION.md")) {
        ui.toast({ variant: "success", title: "Constitution Updated", message: "Coding standards regenerated.", duration: 2000 })
      } else if (path.includes("memory/MEMORY.md")) {
        ui.toast({ variant: "info", title: "Memory Updated", message: "Agent saved a learning.", duration: 2000 })
      } else if (path.includes("AGENTS.md")) {
        ui.toast({ variant: "info", title: "Rules Synced", message: "Studio rules synced to AGENTS.md.", duration: 1500 })
      }
    } catch { /* best-effort */ }
  }))

  // ——— Permission requested → info toast ————————————————
  cleanups.push(event.on("permission.asked", () => {
    try {
      ui.toast({ variant: "info", title: "Permission Requested", message: "Agent needs approval — check the prompt.", duration: 4000 })
    } catch { /* best-effort */ }
  }))

  // ——— Sidebar: studio stats + LSP ————————————————
  cleanups.push(slots.register({
    render: () => {
      const s = readStats()
      const lines: string[] = [
        `[studio] ${s.cost} | ${s.branch}`,
        `  ${s.tasksDone}✓ ${s.tasksOpen}○ | ${s.verify} | ${s.diagnostics}⚠`,
      ]
      try {
        const servers = state.lsp()
        if (servers.length > 0) {
          const ready = servers.every((l: { status: string }) => l.status === "ready")
          lines.push(`  LSP: ${ready ? "✓" : "⚠"} ${servers.length} server(s)`)
        }
      } catch { /* state not ready */ }
      return lines.join("\n") as any
    },
  }))

  // ——— Home footer ————————————————————————
  cleanups.push(slots.register({
    render: () => {
      const s = readStats()
      return `studio: ${s.cost} | ${s.tasksOpen} tasks | ${s.verify} | ${s.branch}` as any
    },
  }))

  // ——— KV preferences ————————————————————————
  kv.set("studio.sidebar.visible", kv.get("studio.sidebar.visible", true))
  kv.set("studio.toasts.enabled", kv.get("studio.toasts.enabled", true))

  // Wrap toast with KV toggle
  const originalToast = ui.toast
  ui.toast = (input: any) => {
    if (kv.get("studio.toasts.enabled", true)) originalToast(input)
  }

  // ——— Cleanup ————————————————————————
  lifecycle.onDispose(() => {
    cleanups.forEach((fn) => { try { fn() } catch { /* best-effort */ } })
    ui.toast = originalToast
  })
}

const tuiModule = { id: "opencode-studio-tui", tui }
export default tuiModule
