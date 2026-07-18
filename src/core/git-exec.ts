import { spawn } from "child_process"

/**
 * Run a git command via argv spawn (no shell). Returns trimmed stdout.
 */
export function gitExec(args: string[], cwd: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, timeout: timeoutMs, shell: false })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed (exit ${code})`))
    })
  })
}
