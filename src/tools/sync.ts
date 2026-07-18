import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { join, relative } from "path"
import { loadConfig } from "../config/config"
import { createSession, closeSession } from "../ssh/manager"
import { createWatcher } from "../sync/watcher"
import type { FSWatcher } from "chokidar"
import { bulkSync, syncFile, syncDirectory, deleteRemoteFile } from "../sync/transfers"
import type { SSHSession } from "../ssh/types"
import { markSyncActive, clearSyncActive } from "../sync/active"
import * as log from "../core/logger"
import { getActiveDirectory } from "../core/active-dir"

export { getActiveSyncProjects } from "../sync/active"

const activeWatchers = new Map<string, FSWatcher>()
const activeSessions = new Map<string, SSHSession>()

function toRemotePath(localRoot: string, remoteRoot: string, filePath: string): string {
  const rel = relative(localRoot, filePath)
  return join(remoteRoot, rel).replace(/\\/g, "/")
}

export async function startProjectSync(projectName: string): Promise<string> {
  const config = loadConfig()
  const projectConfig = config.projects[projectName]

  if (!projectConfig) {
    throw new Error(`Project '${projectName}' not found`)
  }

  if (activeWatchers.has(projectName)) {
    return `Sync for '${projectName}' is already running.`
  }

  if (!config.ssh.host || !config.ssh.identityFile) {
    throw new Error("SSH not configured")
  }

  const session = await createSession(config.ssh)
  activeSessions.set(projectName, session)

  await bulkSync(session, projectConfig.local, projectConfig.remote, projectConfig.excludes)

  const watcher = await createWatcher({
    projectName,
    projectPath: projectConfig.local,
    excludes: projectConfig.excludes,
    handler: async (batch) => {
      for (const event of batch.events) {
        const remotePath = toRemotePath(projectConfig.local, projectConfig.remote, event.path)
        try {
          if (event.type === "add" || event.type === "change") {
            await syncFile(session, event.path, remotePath)
          } else if (event.type === "addDir") {
            await syncDirectory(session, remotePath)
          } else if (event.type === "unlink") {
            await deleteRemoteFile(session, remotePath, false)
          } else if (event.type === "unlinkDir") {
            await deleteRemoteFile(session, remotePath, true)
          }
        } catch (err) {
          log.error(`Error syncing ${event.path}: ${(err as Error).message}`)
        }
      }
    },
  })

  activeWatchers.set(projectName, watcher)
  markSyncActive(projectName)
  return `Sync started for '${projectName}': ${projectConfig.local} → ${config.ssh.host}:${projectConfig.remote}`
}

export async function stopProjectSync(projectName: string): Promise<string> {
  const watcher = activeWatchers.get(projectName)
  if (!watcher) {
    return `No sync running for '${projectName}'.`
  }

  await watcher.close()
  activeWatchers.delete(projectName)
  clearSyncActive(projectName)

  const session = activeSessions.get(projectName)
  if (session) {
    await closeSession(session)
    activeSessions.delete(projectName)
  }

  return `Sync stopped for '${projectName}'.`
}

export const studio_sync_start: ToolDefinition = tool({
  description: "Start real-time file sync for a project (usually automatic — only needed to restart).",
  args: {
    project: tool.schema.string().optional().describe("Project name; defaults to current directory's project"),
  },
  async execute(args) {
    try {
      const config = loadConfig()
      let projectName = args.project
      if (!projectName) {
        const cwd = getActiveDirectory()
        projectName = Object.entries(config.projects).find(
          ([, p]) => cwd === p.local || cwd.startsWith(p.local + "/"),
        )?.[0]
        if (!projectName) {
          return "No project for current directory. Open a configured repo or pass project name."
        }
      }
      return await startProjectSync(projectName)
    } catch (err) {
      return formatSyncError(err as Error)
    }
  },
})

export const studio_sync_stop: ToolDefinition = tool({
  description: "Stop real-time file sync for a project.",
  args: {
    project: tool.schema.string().describe("Project name to stop syncing"),
  },
  async execute(args) {
    return stopProjectSync(args.project)
  },
})

function formatSyncError(err: Error): string {
  const msg = err.message
  if (msg.includes("All configured authentication methods failed")) {
    return "SSH auth failed. Check key path and remote authorized_keys."
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("Connection refused") || msg.includes("connection refused")) {
    return "Cannot connect to remote host. Check VPS is running and port 22 is open."
  }
  if (msg.includes("ENOENT")) {
    return "File or directory not found. Check local project path exists."
  }
  return `Sync error: ${msg}`
}
