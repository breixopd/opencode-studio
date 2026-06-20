import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync } from "fs"
import { ensureStudioReady } from "../core/auto"
import { parseSSHConfig } from "../config/ssh-config"
import { incompleteTasks } from "../core/tasks"
import { isTunnelAlive, getTunnelState } from "../tunnel/manager"
import { getActiveSyncProjects } from "../sync/active"

export const studio_doctor: ToolDefinition = tool({
  description: "Health check: config, SSH, tunnel, sync, tasks, native tools.",
  args: {},
  async execute() {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = []

    try {
      ensureStudioReady()
      checks.push({ name: "config", ok: true, detail: "Auto-configured" })
    } catch (err) {
      checks.push({ name: "config", ok: false, detail: (err as Error).message })
      return JSON.stringify({ healthy: false, checks }, null, 2)
    }

    const config = ensureStudioReady()
    const sshReady = Boolean(config.ssh.host && config.ssh.user && config.ssh.identityFile)
    checks.push({
      name: "ssh",
      ok: sshReady,
      detail: sshReady ? `${config.ssh.user}@${config.ssh.host}` : "Add ~/.ssh/config hosts",
    })

    if (sshReady) {
      checks.push({ name: "ssh_key", ok: existsSync(config.ssh.identityFile), detail: config.ssh.identityFile })
    }

    checks.push({ name: "ssh_hosts", ok: parseSSHConfig().length > 0, detail: `${parseSSHConfig().length} hosts` })

    const tunnelUp = isTunnelAlive()
    checks.push({
      name: "tunnel",
      ok: tunnelUp,
      detail: tunnelUp ? `port ${getTunnelState()?.config.localPort}` : "auto-starts on session",
    })

    const projects = Object.keys(config.projects).length
    checks.push({ name: "projects", ok: projects > 0, detail: `${projects} mapped` })

    const syncs = getActiveSyncProjects()
    checks.push({ name: "sync", ok: true, detail: syncs.length ? syncs.join(", ") : "auto on session" })

    const open = incompleteTasks()
    checks.push({ name: "tasks", ok: open.length === 0, detail: open.length ? `${open.length} open` : "boulder clear" })

    checks.push({
      name: "native_tools",
      ok: true,
      detail: "search, fetch, code_search, task, plan, verify, retrieve, handoff, diagram",
    })

    checks.push({
      name: "subagents",
      ok: true,
      detail: "explore, implement, review, research, remote, verify",
    })

    const healthy = checks.filter((c) => !["tunnel", "tasks"].includes(c.name) || c.ok).every((c) => c.ok)
    return JSON.stringify({ healthy, checks }, null, 2)
  },
})
