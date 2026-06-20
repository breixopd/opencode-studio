import { tool } from "@opencode-ai/plugin"
import { existsSync } from "fs"
import { ensureStudioReady } from "../core/auto"
import { loadConfig } from "../config/config"
import { parseSSHConfig } from "../config/ssh-config"
import { isTunnelAlive, getTunnelState } from "../tunnel/manager"
import { getActiveSyncProjects } from "../sync/active"

export const studio_status = tool({
  description: "Show OpenCode Studio status: tunnel, SSH, projects, active syncs.",
  args: {},
  async execute() {
    const config = ensureStudioReady()
    const projects = config.projects
    const activeSyncs = getActiveSyncProjects()

    const tunnelAlive = isTunnelAlive()
    const tunnelState = getTunnelState()

    const projectList = Object.entries(projects).map(([name, mapping]) => ({
      name,
      local: mapping.local,
      remote: mapping.remote,
      syncing: activeSyncs.includes(name),
    }))

    return JSON.stringify(
      {
        tunnel: tunnelAlive
          ? { status: "running", port: tunnelState?.config.localPort, host: tunnelState?.config.host }
          : { status: "stopped" },
        ssh: {
          host: config.ssh.host,
          user: config.ssh.user,
          port: config.ssh.port,
          configured: Boolean(config.ssh.host && config.ssh.user && config.ssh.identityFile),
        },
        activeSyncs,
        projects: projectList,
        projectCount: projectList.length,
      },
      null,
      2,
    )
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
