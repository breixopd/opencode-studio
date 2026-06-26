/**
 * shell.env hook — injects studio-related environment variables into all
 * shell commands executed by tools and subagents.
 *
 * This lets subprocesses (e.g. studio_verify, studio_git, studio_remote)
 * know where the studio database is and what log level to use.
 */
export function createShellEnvHook() {
  return async (
    input: { cwd: string; sessionID?: string },
    output: { env: Record<string, string> },
  ) => {
    output.env.STUDIO_DB_PATH = `${input.cwd}/.studio/studio.db`
    if (process.env.STUDIO_LOG_LEVEL) {
      output.env.STUDIO_LOG_LEVEL = process.env.STUDIO_LOG_LEVEL
    }
  }
}
