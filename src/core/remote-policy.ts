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

export type RemotePolicyOpts = {
  autonomy?: string
  confirm?: boolean
  /** User has accepted full-autonomy risk via preferences / NL. */
  riskAccepted?: boolean
}

/**
 * Validate host + command against config.remote allowlists and the global
 * destructive blocklist. Pure — safe to unit-test without SSH.
 *
 * Under autonomy=full with empty allowlists: allowed if riskAccepted OR
 * confirm:true. confirm is agent-supplied (not host HITL); user risk accept
 * is the real acknowledgment. Always warn when unrestricted.
 */
export function checkRemotePolicy(
  hostAlias: string,
  command: string,
  remote: RemoteExecConfig | undefined,
  opts?: RemotePolicyOpts,
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
    const riskAccepted = opts?.riskAccepted === true
    const confirmed = opts?.confirm === true

    if (autonomy === "full" && !riskAccepted && !confirmed) {
      return {
        ok: false,
        reason:
          "Autonomy is full and remote allowlists are empty — accept full-autonomy risk " +
          '(studio_preferences accept_autonomy_risk / say "I accept the risk"), ' +
          "set remote.allowedHosts / allowedCommandPrefixes, or pass confirm:true. " +
          "Note: confirm is agent-supplied (not host HITL); user risk accept is the real acknowledgment.",
      }
    }

    const ackParts: string[] = []
    if (riskAccepted) ackParts.push("user risk accepted")
    if (confirmed) ackParts.push("confirm:true was agent-supplied (not host HITL)")
    const ackNote = ackParts.length ? ` ${ackParts.join("; ")}.` : ""

    return {
      ok: true,
      warn:
        "WARNING: remote exec is unrestricted (no allowedHosts / allowedCommandPrefixes). " +
        "Command runs as the SSH user with no sandbox." +
        ackNote,
    }
  }

  return { ok: true }
}
