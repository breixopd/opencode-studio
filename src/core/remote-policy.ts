/**
 * Remote exec policy for studio_remote — allowlists, destructive blocklist,
 * and shell-chaining rejection. Pure — safe to unit-test without SSH.
 */
import type { RemoteExecConfig } from "../config/types"
import { getAutonomyMode } from "./project-profile"

/** Always-blocked substrings — obvious destructive remote commands. */
export const DESTRUCTIVE_REMOTE_PATTERNS = [
  "rm -rf",
  "dd ",
  "mkfs",
  "shutdown",
  "reboot",
  "> /dev/",
] as const

/**
 * Shell chaining / metacharacters — always rejected for studio_remote.
 * Prevents allowlist bypass via `allowedPrefix; evil` or pipe tricks.
 */
const SHELL_CHAIN_RE = /[;|&`\n]|\$\(|&&|\|\|/

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

  if (SHELL_CHAIN_RE.test(cmd)) {
    return {
      ok: false,
      reason:
        "Blocked shell chaining / metacharacters (; | & ` $() newlines && ||). " +
        "studio_remote accepts a single command only — no pipes or compound shells.",
    }
  }

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
          "unrestricted studio_remote, or set remote.allowedHosts / allowedCommandPrefixes. " +
          "Note: confirm is agent-supplied (not host HITL).",
      }
    }
    const confirmNote =
      opts?.confirm === true
        ? " confirm:true was agent-supplied (not host HITL)."
        : ""
    return {
      ok: true,
      warn:
        "WARNING: remote exec is unrestricted (no allowedHosts / allowedCommandPrefixes). " +
        "Command runs as the SSH user with no sandbox." +
        confirmNote,
    }
  }

  return { ok: true }
}
