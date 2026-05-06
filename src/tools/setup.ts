import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { loadConfig, saveConfig } from "../config/config"
import { parseSSHConfig } from "../config/ssh-config"

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

    // If host parameter given, select that specific host
    if (args.host) {
      const selected = hosts.find(h => h.alias === args.host)
      if (!selected) {
        return JSON.stringify({
          status: "not_found",
          requested: args.host,
          all_hosts: hosts.map(h => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile })),
          message: `Host '${args.host}' not found in ~/.ssh/config. Available: ${hosts.map(h => h.alias).join(", ")}`,
        })
      }
      const config = {
        ...existing,
        ssh: {
          user: selected.user || "",
          host: selected.host || selected.alias,
          identityFile: selected.identityFile || "",
        },
        tunnel: {
          ...existing.tunnel,
          host: selected.host || selected.alias,
        },
      }
      saveConfig(config)
      return JSON.stringify({
        status: "selected",
        host: selected.alias,
        all_hosts: hosts.map(h => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile })),
        message: `Selected '${selected.alias}' (${selected.user}@${selected.host}). Run studio_status to verify.`,
      })
    }

    // No host specified — return list and ask user to choose
    const keyHosts = hosts.filter(h => h.identityFile && h.host)
    const hasMultiple = keyHosts.length > 1 || hosts.length > 1

    if (hasMultiple) {
      return JSON.stringify({
        status: "multiple_hosts",
        all_hosts: hosts.map(h => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile })),
        message: `Found ${hosts.length} SSH hosts. Which would you like to use? Use studio_setup({ host: "<alias>" }) to select.`,
      })
    }

    // Single host — auto-select
    const first = keyHosts[0] || hosts[0]
    const config = {
      ...existing,
      ssh: {
        user: first.user || "",
        host: first.host || first.alias,
        identityFile: first.identityFile || "",
      },
      tunnel: {
        ...existing.tunnel,
        host: first.host || first.alias,
      },
    }
    saveConfig(config)

    return JSON.stringify({
      status: "detected",
      detected_host: first,
      all_hosts: hosts.map(h => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile })),
      config: { host: config.ssh.host, user: config.ssh.user, port: config.tunnel.localPort },
      message: `Auto-detected '${first.alias}' as default. Use studio_setup({ host: "<alias>" }) to change.`,
    })
  },
})
