/** Native DuckDuckGo search — no API key. ponytail: fetch + regex, no MCP dependency */
export async function searchDuckDuckGo(
  query: string,
  maxResults = 8,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const body = new URLSearchParams({ q: query })
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "opencode-studio/1.0",
    },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`Search failed: HTTP ${res.status}`)
  }

  const html = await res.text()
  const results: Array<{ title: string; url: string; snippet: string }> = []

  const linkRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html)) !== null && results.length < maxResults) {
    const url = decodeDuckDuckGoUrl(match[1])
    const title = stripHtml(match[2])
    const snippet = stripHtml(match[3])
    if (url && title) {
      results.push({ title, url, snippet })
    }
  }

  return results
}

function decodeDuckDuckGoUrl(href: string): string {
  if (href.startsWith("//duckduckgo.com/l/?")) {
    const uddg = new URL(`https:${href}`).searchParams.get("uddg")
    if (uddg) return decodeURIComponent(uddg)
  }
  return href
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
}
