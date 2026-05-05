import { tool } from "@opencode-ai/plugin"
import { loadConfig, listProjects } from "../config/config"
import { isTunnelAlive, getTunnelState } from "../tunnel/manager"

export const studio_status = tool({
  description:
    "Show overall OpenCode Studio status: tunnel health, configured projects, and active syncs.",
  args: {},
  async execute() {
    const config = loadConfig()
    const projects = listProjects(config)

    const tunnelAlive = isTunnelAlive()
    const tunnelState = getTunnelState()

    const projectList = Object.entries(projects).map(([name, mapping]) => ({
      name,
      local: mapping.local,
      remote: mapping.remote,
      excludes: mapping.excludes,
    }))

    return JSON.stringify(
      {
        tunnel: tunnelAlive
          ? {
              status: "running",
              port: tunnelState?.config.localPort,
              host: tunnelState?.config.host,
            }
          : { status: "stopped" },
        ssh: {
          host: config.ssh.host,
          user: config.ssh.user,
        },
        projects: projectList,
        projectCount: projectList.length,
      },
      null,
      2,
    )
  },
})

export const studio_list_projects = tool({
  description:
    "List all configured remote development projects with their local/remote paths.",
  args: {},
  async execute() {
    const config = loadConfig()
    const projects = listProjects(config)
    const names = Object.keys(projects)

    if (names.length === 0) {
      return "No projects configured. Use studio_add_project to add one."
    }

    const lines = names.map((name) => {
      const p = projects[name]
      return `  ${name}: ${p.local} → ${config.ssh.host}:${p.remote}`
    })

    return `Configured projects (${names.length}):\n${lines.join("\n")}`
  },
})
