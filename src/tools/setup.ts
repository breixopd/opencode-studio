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
  },
  async execute(args) {
    const existing = loadConfig()

    if (!args.force && existing.ssh.host) {
      return JSON.stringify({
        status: "configured",
        config: {
          host: existing.ssh.host,
          user: existing.ssh.user,
          port: existing.tunnel.localPort,
        },
        message: "Already configured. Use force: true to re-detect.",
      })
    }

    const hosts = parseSSHConfig()
    if (hosts.length === 0) {
      return JSON.stringify({
        status: "no_hosts",
        message:
          "No SSH hosts found in ~/.ssh/config. Create a config at ~/.config/opencode-studio/config.json manually.",
      })
    }

    const first = hosts[0]
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
      all_hosts: hosts.map((h) => ({ alias: h.alias, host: h.host, user: h.user })),
      config: {
        host: config.ssh.host,
        user: config.ssh.user,
        port: config.tunnel.localPort,
      },
      message: `Auto-detected '${first.alias}' as default host. Run studio_status to verify connectivity.`,
    })
  },
})
