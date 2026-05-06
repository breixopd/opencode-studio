import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { loadConfig } from "../config/config"
import { createSession } from "../ssh/manager"
import { createWatcher } from "../sync/watcher"
import { bulkSync, syncFile, deleteRemoteFile } from "../sync/transfers"
import type { SSHSession } from "../ssh/types"

const activeWatchers = new Map<string, ReturnType<typeof createWatcher>>()
const activeSessions = new Map<string, SSHSession>()

export const studio_sync_start: ToolDefinition = tool({
  description:
    "Start real-time file sync for a configured remote dev project. File changes will automatically propagate to the remote.",
  args: {
    project: tool.schema.string().describe("Project name (configured via studio_add_project)"),
  },
  async execute(args) {
    const config = loadConfig()
    const projectConfig = config.projects[args.project]

    if (!projectConfig) {
      return `Error: Project '${args.project}' not found. Use studio_list_projects to see configured projects.`
    }

    if (activeWatchers.has(args.project)) {
      return `Sync for '${args.project}' is already running.`
    }

    const session = await createSession(config.ssh)
    activeSessions.set(args.project, session)

    try {
      await bulkSync(session, projectConfig.local, projectConfig.remote, projectConfig.excludes)
    } catch (err) {
      return `Error during bulk sync: ${(err as Error).message}`
    }

    const watcher = createWatcher({
      projectName: args.project,
      projectPath: projectConfig.local,
      excludes: projectConfig.excludes,
      handler: async (batch) => {
        for (const event of batch.events) {
          const remotePath = event.path.replace(projectConfig.local, projectConfig.remote)

          try {
            if (event.type === "add" || event.type === "change") {
              await syncFile(session, event.path, remotePath)
            } else if (event.type === "unlink" || event.type === "unlinkDir") {
              await deleteRemoteFile(session, remotePath)
            }
          } catch (err) {
            console.error(`[studio-sync] Error syncing ${event.path}:`, (err as Error).message)
          }
        }
      },
    })

    activeWatchers.set(args.project, watcher)
    return `Sync started for '${args.project}': ${projectConfig.local} → ${config.ssh.host}:${projectConfig.remote}`
  },
})

export const studio_sync_stop: ToolDefinition = tool({
  description: "Stop real-time file sync for a project.",
  args: {
    project: tool.schema.string().describe("Project name to stop syncing"),
  },
  async execute(args) {
    const watcher = activeWatchers.get(args.project)

    if (!watcher) {
      return `No sync running for '${args.project}'.`
    }

    await watcher.close()
    activeWatchers.delete(args.project)

    const session = activeSessions.get(args.project)
    if (session) {
      session.client.end()
      activeSessions.delete(args.project)
    }

    return `Sync stopped for '${args.project}'.`
  },
})
