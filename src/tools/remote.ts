import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { homedir } from "os"
import { createSession, execCommand, closeSession } from "../ssh/manager"
import { parseSSHConfig } from "../config/ssh-config"
import { loadConfig } from "../config/config"
import type { RemoteExecConfig } from "../config/types"
import { getAutonomyMode } from "../core/project-profile"
import * as log from "../core/logger"

/** Always-blocked substrings — obvious destructive remote commands. */
export const DESTRUCTIVE_REMOTE_PATTERNS = [
  "rm -rf",
  "dd ",
  "mkfs",
  "shutdown",
  "reboot",
  "> /dev/",
] as const

export type RemotePolicyResult =
  | { ok: true; warn?: string }
  | { ok: false; reason: string }

/**
 * Validate host + command against config.remote allowlists and the global
 * destructive blocklist. Pure — safe to unit-test without SSH.
 */
export function checkRemotePolicy(
  hostAlias: string,
  command: string,
  remote: RemoteExecConfig | undefined,
  opts?: { autonomy?: string; confirm?: boolean },
): RemotePolicyResult {
  const cmd = command.trim()
  const lower = cmd.toLowerCase()

  for (const pat of DESTRUCTIVE_REMOTE_PATTERNS) {
    if (lower.includes(pat)) {
      return {
        ok: false,
        reason:
          `Blocked destructive pattern '${pat.trim()}'. ` +
          `studio_remote refuses rm -rf, dd, mkfs, shutdown, reboot, and > /dev/ redirects.`,
      }
    }
  }

  const hosts = remote?.allowedHosts?.filter((h) => h.trim()) ?? []
  if (hosts.length > 0) {
    const allowed = hosts.some(
      (h) => h === hostAlias || hostAlias === h || hostAlias.startsWith(h),
    )
    if (!allowed) {
      return {
        ok: false,
        reason:
          `Host '${hostAlias}' is not in remote.allowedHosts ` +
          `[${hosts.join(", ")}]. Update via studio_preferences set_remote_policy.`,
      }
    }
  }

  const prefixes = remote?.allowedCommandPrefixes?.filter((p) => p.trim()) ?? []
  if (prefixes.length > 0) {
    const ok = prefixes.some((p) => cmd.startsWith(p))
    if (!ok) {
      return {
        ok: false,
        reason:
          `Command does not start with any allowedCommandPrefixes ` +
          `[${prefixes.map((p) => JSON.stringify(p)).join(", ")}]. ` +
          `Update via studio_preferences set_remote_policy.`,
      }
    }
  }

  const unrestricted = hosts.length === 0 && prefixes.length === 0
  if (unrestricted) {
    const autonomy = opts?.autonomy ?? getAutonomyMode()
    if (autonomy === "full" && !opts?.confirm) {
      return {
        ok: false,
        reason:
          "Autonomy is full and remote allowlists are empty — pass confirm:true to run " +
          "unrestricted studio_remote, or set remote.allowedHosts / allowedCommandPrefixes.",
      }
    }
    return {
      ok: true,
      warn:
        "WARNING: remote exec is unrestricted (no allowedHosts / allowedCommandPrefixes). " +
        "Command runs as the SSH user with no sandbox.",
    }
  }

  return { ok: true }
}

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
      "Optional config.remote.allowedHosts / allowedCommandPrefixes restrict targets. " +
      "When allowlists are empty and autonomy=full, pass confirm:true.",
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
      .describe("Required when autonomy=full and remote allowlists are empty"),
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
