import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { resolveGitHubAuth } from "../core/github-auth"

interface CodeHit {
  repo: string
  path: string
  url: string
  snippet: string
}

/**
 * Native GitHub code search.
 * Auth: GITHUB_TOKEN / GH_TOKEN / `gh auth token` (same login as `gh` / CI triage).
 */
export async function searchGitHubCode(query: string, max = 8): Promise<CodeHit[]> {
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${max}`
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "opencode-studio",
  }
  const { token } = await resolveGitHubAuth()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `GitHub search HTTP ${res.status} — sign in with \`gh auth login\` or set GITHUB_TOKEN/GH_TOKEN`,
      )
    }
    throw new Error(`GitHub search HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    items?: Array<{
      name: string
      path: string
      html_url: string
      repository?: { full_name: string }
    }>
  }
  return (data.items ?? []).map((item) => ({
    repo: item.repository?.full_name ?? "unknown",
    path: item.path,
    url: item.html_url,
    snippet: item.name,
  }))
}

export const studio_code_search: ToolDefinition = tool({
  description:
    "Search public GitHub repos (uses GITHUB_TOKEN, GH_TOKEN, or `gh auth` system login — not this workspace). For local code use studio_grep.",
  args: {
    query: tool.schema.string().describe("Code search query"),
    count: tool.schema.number().optional().describe("Max results (default 8)"),
  },
  async execute(args) {
    try {
      const hits = await searchGitHubCode(args.query, args.count ?? 8)
      if (hits.length === 0) return `No results for: ${args.query}`
      return hits.map((h, i) => `${i + 1}. ${h.repo}/${h.path}\n   ${h.url}`).join("\n\n")
    } catch (err) {
      return `Code search failed: ${(err as Error).message}. Try studio_search for web results.`
    }
  },
})
