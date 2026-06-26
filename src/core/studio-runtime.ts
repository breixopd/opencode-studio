import { ensureStudioReady } from "./auto"
import { getModelMode } from "./project-profile"
import {
  getVerifyState,
  incompleteTasks,
  listPinnedContext,
} from "./workspace"

export interface StudioRuntimeSnapshot {
  tunnel: { status: "running" | "stopped"; port?: number; host?: string }
  ssh: {
    host: string
    user: string
    port?: number
    configured: boolean
  }
  activeSyncs: string[]
  projects: Array<{ name: string; local: string; remote: string; syncing: boolean }>
  projectCount: number
  openTasks: number
  verifyPassed: boolean | null
  pinnedContextCount: number
  modelMode: string
}

export function collectStudioRuntime(
  deps: {
    tunnelAlive: () => boolean
    tunnelState: () => { config: { localPort: number; host: string } } | null
    activeSyncs: () => string[]
  },
): StudioRuntimeSnapshot {
  const config = ensureStudioReady()
  const tunnelAlive = deps.tunnelAlive()
  const tunnelState = deps.tunnelState()
  const activeSyncs = deps.activeSyncs()
  const verify = getVerifyState()

  const projectList = Object.entries(config.projects).map(([name, mapping]) => ({
    name,
    local: mapping.local,
    remote: mapping.remote,
    syncing: activeSyncs.includes(name),
  }))

  return {
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
      port: config.ssh.port,
      configured: Boolean(config.ssh.host && config.ssh.user && config.ssh.identityFile),
    },
    activeSyncs,
    projects: projectList,
    projectCount: projectList.length,
    openTasks: incompleteTasks().length,
    verifyPassed: verify ? verify.passed : null,
    pinnedContextCount: listPinnedContext().length,
    modelMode: getModelMode(),
  }
}
