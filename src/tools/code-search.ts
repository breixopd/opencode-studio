import { tool, type ToolDefinition } from "@opencode-ai/plugin"

interface CodeHit {
  repo: string
  path: string
  url: string
  snippet: string
}

/** Native GitHub code search — unauthenticated, rate-limited */
export async function searchGitHubCode(query: string, max = 8): Promise<CodeHit[]> {
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${max}`
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "opencode-studio",
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    throw new Error(`GitHub search HTTP ${res.status}`)
  }
  const data = (await res.json()) as { items?: Array<{ name: string; path: string; html_url: string; repository?: { full_name: string } }> }
  return (data.items ?? []).map((item) => ({
    repo: item.repository?.full_name ?? "unknown",
    path: item.path,
    url: item.html_url,
    snippet: item.name,
  }))
}

export const studio_code_search: ToolDefinition = tool({
  description: "Search public GitHub repos (not this workspace). For local code use studio_grep.",
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
