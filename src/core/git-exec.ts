import { spawn } from "child_process"

/**
 * Run a git command via argv spawn (no shell). Returns trimmed stdout.
 * Optional `env` merges over `process.env` (e.g. GH_TOKEN for HTTPS remotes).
 */
export function gitExec(
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd,
      timeout: timeoutMs,
      shell: false,
      env: env ?? process.env,
    })
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
