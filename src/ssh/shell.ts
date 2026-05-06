import { execCommand } from "./manager"
import type { SSHSession } from "./types"

export async function detectRemoteShell(session: SSHSession): Promise<string> {
  try {
    const result = await execCommand(session, "echo $SHELL")
    return result.trim() || "/bin/sh"
  } catch {
    return "/bin/sh"
  }
}
