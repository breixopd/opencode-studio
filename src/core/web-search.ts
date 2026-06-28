import * as log from "./logger"
/** Web search — DuckDuckGo (keyless default) + optional Tavily. */
import { BROWSER_HEADERS } from "./web-fetch"
import { stripHtml } from "./web-extract"
import { safeFetch } from "./web-fetch"
import { extractFromHtml, formatForLlm } from "./web-extract"

export interface SearchResult {
  title: string
  url: string
  snippet: string
  content?: string
}

function decodeDuckDuckGoUrl(href: string): string {
  if (href.startsWith("//duckduckgo.com/l/?")) {
    const uddg = new URL(`https:${href}`).searchParams.get("uddg")
    if (uddg) return decodeURIComponent(uddg)
  }
  return href
}

export async function searchDuckDuckGo(
  query: string,
  maxResults = 8,
): Promise<SearchResult[]> {
  const body = new URLSearchParams({ q: query })
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`)

  const html = await res.text()
  const results: SearchResult[] = []
  const linkRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html)) !== null && results.length < maxResults) {
    const url = decodeDuckDuckGoUrl(match[1])
    const title = stripHtml(match[2])
    const snippet = stripHtml(match[3])
    if (url && title) results.push({ title, url, snippet })
  }

  return results
}

/** Optional: set TAVILY_API_KEY for higher-quality results (tavily.com). */
export async function searchTavily(
  query: string,
  maxResults = 8,
  apiKey: string,
): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Tavily failed: HTTP ${res.status}`)
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (data.results ?? [])
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 300),
    }))
    .filter((r) => r.title && r.url)
}

export async function searchWeb(
  query: string,
  maxResults = 8,
): Promise<{ backend: string; results: SearchResult[] }> {
  const tavilyKey = process.env.TAVILY_API_KEY?.trim()
  if (tavilyKey) {
    try {
      const results = await searchTavily(query, maxResults, tavilyKey)
      if (results.length) return { backend: "tavily", results }
    } catch (err) {
      log.debugCatch("src/core/web-search.ts", err);
      /* fall through to keyless */
    }
  }
  const results = await searchDuckDuckGo(query, maxResults)
  return { backend: "duckduckgo", results }
}

export async function scrapeSearchResults(
  results: SearchResult[],
  topN: number,
  maxChars = 6000,
): Promise<SearchResult[]> {
  const slice = results.slice(0, Math.min(topN, 5))
  const out: SearchResult[] = []

  for (const r of slice) {
    try {
      const res = await safeFetch(r.url)
      if (!res.contentType.includes("json") && res.contentType.includes("html")) {
        const page = await extractFromHtml(res.body, res.finalUrl)
        out.push({
          ...r,
          content: formatForLlm(page, "llm", maxChars),
        })
      } else if (res.contentType.includes("json")) {
        out.push({ ...r, content: res.body.slice(0, maxChars) })
      } else {
        out.push({ ...r, content: res.body.slice(0, maxChars) })
      }
    } catch (err) {
      log.debugCatch("src/core/web-search.ts", err);
      /* enrichment best-effort — keep the unenriched result */
      out.push(r)
    }
  }

  return out
}

export function formatSearchResults(
  results: SearchResult[],
  backend: string,
): string {
  if (!results.length) return ""
  const header = `[search via ${backend}]\n`
  return (
    header +
    results
      .map((r, i) => {
        const base = `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
        return r.content ? `${base}\n\n${r.content}` : base
      })
      .join("\n\n")
  )
}
