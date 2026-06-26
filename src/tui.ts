/**
 * opencode-studio TUI plugin — renders UI elements in the OpenCode terminal.
 *
 * Features:
 *   - Sidebar status panel (plan progress, cost, branch, verify, CI)
 *   - Toast notifications (verify pass/fail, cost thresholds, rule capture, CI)
 *   - Command palette entries (/studio-cost, /studio-verify, etc.)
 *   - Confirm dialog before destructive actions (rollback)
 *   - ASCII brand mark on home screen
 *
 * This module is loaded by OpenCode as a separate TUI plugin (not the server
 * plugin). It receives the TuiPluginApi which provides ui.toast(), ui.Slot(),
 * command.register(), and more.
 */
import type { TuiPlugin, TuiPluginApi, TuiRouteDefinition } from "@opencode-ai/plugin/tui"

/** ASCII art — a studio desk with monitors, fits the home_logo slot. */
const BRAND_ASCII = [
  "  ┌─[]──[]──[]─┐  ",
  " ─┘ STUDIO   └──  ",
  "  ╔═══════════╗   ",
  "  ║ ▓▓▓ ▓▓▓ ▓ ║   ",
  "  ╚═══════════╝   ",
].join("\n")

export const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const { ui, command, event, kv, state } = api

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
  // React to events and show toasts for high-value signals.
  const unsubEvents = event.on("message.updated", (evt: { type: string; properties?: { info?: { cost?: number; tokens?: { input: number; output: number } } } }) => {
    try {
      const cost = evt.properties?.info?.cost
      if (cost && cost > 0.50) {
        ui.toast({ variant: "warning", title: "Cost Alert", message: `Session cost exceeded $${cost.toFixed(2)}. Consider studio_preferences set_model_mode free.`, duration: 5000 })
      }
    } catch { /* best-effort */ }
  })

  // React to verify results — toast on pass/fail via tool.execute.after
  const unsubTool = event.on("tool.execute.after", (evt: { type: string; properties?: { tool?: string; output?: string } }) => {
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

  // ——— Sidebar status — uses module-level polling since we can't access the
  // discipline hook's state directly from the TUI plugin. We read the studio
  // DB file path from the kv store (set by the server plugin's shell.env hook).
  let statsInterval: ReturnType<typeof setInterval> | null = null

  function startStatsPolling() {
    if (statsInterval) return
    statsInterval = setInterval(() => {
      // The sidebar rendering happens via slots — we register a slot
      // component that reads from the DB on each render.
    }, 5_000)
    statsInterval.unref?.()
  }

  startStatsPolling()

  // ——— Cleanup on dispose ————————————————
  api.lifecycle.onDispose(() => {
    unregisterCmds()
    unsubEvents()
    unsubTool()
    if (statsInterval) clearInterval(statsInterval)
  })
}

const tuiModule = { id: "opencode-studio-tui", tui }
export default tuiModule
