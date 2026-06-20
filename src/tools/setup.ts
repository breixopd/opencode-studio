import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { loadConfig, saveConfig } from "../config/config"
import { parseSSHConfig } from "../config/ssh-config"
import type { StudioConfig } from "../config/types"

function applyHost(existing: StudioConfig, selected: ReturnType<typeof parseSSHConfig>[number]): StudioConfig {
  return {
    ...existing,
    ssh: {
      user: selected.user || "",
      host: selected.host || selected.alias,
      identityFile: selected.identityFile || "",
      port: selected.port,
    },
    tunnel: {
      ...existing.tunnel,
      host: selected.host || selected.alias,
    },
  }
}

export const studio_setup: ToolDefinition = tool({
  description:
    "First-time setup wizard for opencode-studio. Auto-detects SSH hosts from ~/.ssh/config and helps configure remote development.",
  args: {
    force: tool.schema
      .boolean()
      .optional()
      .describe("Force re-detection even if config exists"),
    host: tool.schema
      .string()
      .optional()
      .describe("SSH host alias to use (from ~/.ssh/config). If omitted, auto-selects the first host with key-based auth."),
  },
  async execute(args) {
    const existing = loadConfig()
    const hosts = parseSSHConfig()

    if (hosts.length === 0) {
      return JSON.stringify({
        status: "no_hosts",
        message: "No SSH hosts found in ~/.ssh/config. Add hosts to ~/.ssh/config or configure manually.",
      })
    }

    if (existing.ssh.host && !args.force && !args.host) {
      return JSON.stringify({
        status: "already_configured",
        ssh: { host: existing.ssh.host, user: existing.ssh.user, port: existing.ssh.port },
        message: "Studio is already configured. Use studio_setup({ force: true }) to re-detect or studio_setup({ host: '<alias>' }) to switch hosts.",
      })
    }

    if (args.host) {
      const selected = hosts.find((h) => h.alias === args.host)
      if (!selected) {
        return JSON.stringify({
          status: "not_found",
          requested: args.host,
          all_hosts: hosts.map((h) => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile })),
          message: `Host '${args.host}' not found in ~/.ssh/config. Available: ${hosts.map((h) => h.alias).join(", ")}`,
        })
      }
      saveConfig(applyHost(existing, selected))
      return JSON.stringify({
        status: "selected",
        host: selected.alias,
        all_hosts: hosts.map((h) => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile })),
        message: `Selected '${selected.alias}' (${selected.user}@${selected.host}). Run studio_status to verify.`,
      })
    }

    const keyHosts = hosts.filter((h) => h.identityFile && h.host)
    const hasMultiple = keyHosts.length > 1 || hosts.length > 1

    if (hasMultiple && !args.force) {
      return JSON.stringify({
        status: "multiple_hosts",
        all_hosts: hosts.map((h) => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile })),
        message: `Found ${hosts.length} SSH hosts. Which would you like to use? Use studio_setup({ host: "<alias>" }) to select.`,
      })
    }

    const first = keyHosts[0] || hosts[0]
    const config = applyHost(existing, first)
    saveConfig(config)

    return JSON.stringify({
      status: "detected",
      detected_host: first,
      all_hosts: hosts.map((h) => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile })),
      config: { host: config.ssh.host, user: config.ssh.user, port: config.ssh.port ?? config.tunnel.localPort },
      message: `Auto-detected '${first.alias}' as default. Use studio_setup({ host: "<alias>" }) to change.`,
    })
  },
})
