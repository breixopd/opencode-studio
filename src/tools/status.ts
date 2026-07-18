import { tool } from "@opencode-ai/plugin"
import { ensureStudioReady } from "../core/auto"
import { isTunnelAlive, getTunnelState } from "../tunnel/manager"
import { getActiveSyncProjects } from "../sync/active"
import { collectStudioRuntime } from "../core/studio-runtime"
import { describeRoutingForProvider } from "../core/model-routing"
import type { Config } from "@opencode-ai/plugin"

export const studio_status = tool({
  description: "Studio runtime snapshot: tunnel, SSH, projects, syncs, tasks, verify gate, model mode.",
  args: {},
  async execute() {
    // Resolve deps at call time so test mocks (and live ESM bindings) apply.
    const snapshot = collectStudioRuntime({
      tunnelAlive: isTunnelAlive,
      tunnelState: getTunnelState,
      activeSyncs: getActiveSyncProjects,
    })
    return JSON.stringify(snapshot, null, 2)
  },
})

export const studio_list_projects = tool({
  description: "List configured remote projects (auto-detected from git repos).",
  args: {},
  async execute() {
    const config = ensureStudioReady()
    const activeSyncs = getActiveSyncProjects()
    const names = Object.keys(config.projects)

    if (names.length === 0) {
      return "No projects yet — open a git repo and studio will map it automatically."
    }

    const lines = names.map((name) => {
      const p = config.projects[name]
      const syncTag = activeSyncs.includes(name) ? " [syncing]" : ""
      return `  ${name}${syncTag}: ${p.local} → ${config.ssh.host}:${p.remote}`
    })

    return `Projects (${names.length}):\n${lines.join("\n")}`
  },
})

export function studioRoutingSummary(config: Config): string {
  return describeRoutingForProvider(config)
}
