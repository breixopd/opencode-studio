import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { homedir } from "os"
import { createSession, execCommand, closeSession } from "../ssh/manager"
import { parseSSHConfig } from "../config/ssh-config"
import { loadConfig } from "../config/config"
import { checkRemotePolicy } from "../core/remote-policy"
import * as log from "../core/logger"

// Re-export policy helpers for callers that imported from tools/remote
export {
  DESTRUCTIVE_REMOTE_PATTERNS,
  checkRemotePolicy,
  type RemotePolicyResult,
} from "../core/remote-policy"

/**
 * studio_remote — SSH exec for running commands on a remote box.
 *
 * Phase 6.3: useful when the local box can't run the stack (DB, GPU, etc.).
 * Reads host alias from ~/.ssh/config. Uses ssh2 for the connection.
 */
export const studio_remote: ToolDefinition = tool({
  description:
    "Run a command on a remote host via SSH. Use for verify/tests/etc when the local box can't run the stack. " +
      "Host aliases come from ~/.ssh/config. " +
      "Destructive patterns (rm -rf, dd, mkfs, shutdown, reboot, > /dev/) are always blocked. " +
      "Shell chaining (; | & ` $() && ||) is always rejected. " +
      "Optional config.remote.allowedHosts / allowedCommandPrefixes restrict targets. " +
      "When allowlists are empty and autonomy=full, pass confirm:true (agent-supplied, not host HITL).",
  args: {
    host: tool.schema
      .string()
      .describe("SSH host alias from ~/.ssh/config (e.g. 'dev-server')"),
    command: tool.schema.string().describe("Shell command to execute on the remote host"),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Timeout in seconds (default 120)"),
    confirm: tool.schema
      .boolean()
      .optional()
      .describe("Required when autonomy=full and remote allowlists are empty (agent-supplied, not host HITL)"),
  },
  async execute(args) {
    if (!args.command?.trim()) {
      return "Empty command rejected. Provide a non-empty shell command to run on the remote host."
    }

    const config = loadConfig()
    const policy = checkRemotePolicy(args.host, args.command, config.remote, {
      confirm: args.confirm === true,
    })
    if (!policy.ok) return `✗ ${policy.reason}`
    if (policy.warn) log.warn(policy.warn)

    const hosts = parseSSHConfig()
    const host = hosts.find((h) => h.alias === args.host || h.host === args.host)
    if (!host) {
      const available = hosts.map((h) => h.alias).join(", ") || "(none — add hosts to ~/.ssh/config)"
      return `Host '${args.host}' not found in ~/.ssh/config. Available: ${available}`
    }

    let session
    try {
      session = await createSession({
        host: host.host,
        port: host.port ?? 22,
        user: host.user ?? process.env.USER ?? "root",
        identityFile: host.identityFile ?? `${homedir()}/.ssh/id_rsa`,
      })
    } catch (err) {
      return `SSH connection failed: ${(err as Error).message}`
    }

    const timeoutMs = (args.timeout ?? 120) * 1000
    const timer = setTimeout(() => {
      closeSession(session).catch(() => {})
    }, timeoutMs)

    try {
      const out = await execCommand(session, args.command)
      // Truncate output for token efficiency.
      const max = 8000
      const result = out.length > max ? `${out.slice(0, max)}\n\n… [${out.length - max} chars truncated]` : out
      return `$ ${args.command}\non ${args.host}:\n\n${result}`
    } catch (err) {
      const e = err as Error
      return `✗ Command failed on ${args.host}:\n$ ${args.command}\n\n${e.message.slice(0, 4000)}`
    } finally {
      clearTimeout(timer)
      await closeSession(session).catch(() => {})
    }
  },
})
