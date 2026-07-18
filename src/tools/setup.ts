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

function hostSummaries(hosts: ReturnType<typeof parseSSHConfig>) {
  return hosts.map((h) => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile }))
}

export const studio_setup: ToolDefinition = tool({
  description:
    "First-time setup wizard for opencode-studio. Lists SSH hosts from ~/.ssh/config and binds only when you pass host=<alias> explicitly (nothing is auto-saved on session start).",
  args: {
    force: tool.schema
      .boolean()
      .optional()
      .describe("Force re-bind even if SSH is already configured (still requires host)"),
    host: tool.schema
      .string()
      .optional()
      .describe("SSH host alias to bind (from ~/.ssh/config). Required to persist — omit to list candidates only."),
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
        all_hosts: hostSummaries(hosts),
        message:
          "Studio is already configured. Use studio_setup({ host: '<alias>', force: true }) to switch hosts.",
      })
    }

    if (!args.host) {
      return JSON.stringify({
        status: "candidates",
        all_hosts: hostSummaries(hosts),
        message: `Found ${hosts.length} SSH host(s). Confirm with studio_setup({ host: "<alias>" }) — nothing was saved.`,
      })
    }

    const selected = hosts.find((h) => h.alias === args.host)
    if (!selected) {
      return JSON.stringify({
        status: "not_found",
        requested: args.host,
        all_hosts: hostSummaries(hosts),
        message: `Host '${args.host}' not found in ~/.ssh/config. Available: ${hosts.map((h) => h.alias).join(", ")}`,
      })
    }

    saveConfig(applyHost(existing, selected))
    return JSON.stringify({
      status: "selected",
      host: selected.alias,
      all_hosts: hostSummaries(hosts),
      message: `Selected '${selected.alias}' (${selected.user}@${selected.host}). Run studio_status to verify.`,
    })
  },
})
