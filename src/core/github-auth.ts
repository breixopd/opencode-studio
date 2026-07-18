/**
 * Resolve a GitHub API token from the environment or the authenticated `gh` CLI.
 *
 * Order: GITHUB_TOKEN → GH_TOKEN → `gh auth token` (keyring / gh login).
 * Matches how CI triage already expects system `gh` auth.
 */
import { spawn } from "child_process"
import * as log from "./logger"

export type GitHubAuthSource = "GITHUB_TOKEN" | "GH_TOKEN" | "gh" | "none"

let cachedToken: string | null | undefined
let cachedSource: GitHubAuthSource | undefined

function envToken(): { token: string; source: "GITHUB_TOKEN" | "GH_TOKEN" } | undefined {
  const github = process.env.GITHUB_TOKEN?.trim()
  if (github) return { token: github, source: "GITHUB_TOKEN" }
  const gh = process.env.GH_TOKEN?.trim()
  if (gh) return { token: gh, source: "GH_TOKEN" }
  return undefined
}

function ghAuthToken(timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", ["auth", "token"], { shell: false, timeout: timeoutMs })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("error", reject)
    proc.on("close", (code) => {
      const token = stdout.trim()
      if (code === 0 && token) resolve(token)
      else reject(new Error(stderr.trim() || "gh auth token failed"))
    })
  })
}

/** Clear memoized token (tests / after login). */
export function clearGitHubTokenCache(): void {
  cachedToken = undefined
  cachedSource = undefined
}

/** Resolve token + where it came from (cached after first success/failure). */
export async function resolveGitHubAuth(): Promise<{
  token?: string
  source: GitHubAuthSource
}> {
  const fromEnv = envToken()
  if (fromEnv) return fromEnv

  if (cachedToken !== undefined) {
    return {
      token: cachedToken ?? undefined,
      source: cachedSource ?? (cachedToken ? "gh" : "none"),
    }
  }

  try {
    const token = await ghAuthToken()
    cachedToken = token
    cachedSource = "gh"
    return { token, source: "gh" }
  } catch (err) {
    log.debugCatch("src/core/github-auth.ts:resolveGitHubAuth", err)
    cachedToken = null
    cachedSource = "none"
    return { source: "none" }
  }
}

export async function resolveGitHubToken(): Promise<string | undefined> {
  const { token } = await resolveGitHubAuth()
  return token
}

/** Human-readable status for doctor / help. */
export async function githubAuthStatusLine(): Promise<string> {
  const { token, source } = await resolveGitHubAuth()
  if (!token) {
    return "not signed in — set GITHUB_TOKEN/GH_TOKEN or run `gh auth login`"
  }
  if (source === "gh") return "ok via `gh auth` (system login)"
  return `ok via ${source}`
}
