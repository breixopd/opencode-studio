import * as log from "./logger"
import { parseHTML } from "linkedom"
import { safeFetch } from "./web-fetch"
import { extractFromHtml, formatForLlm } from "./web-extract"

export interface CrawlHit {
  url: string
  title: string
  excerpt: string
}

export interface CrawlOptions {
  maxPages?: number
  maxDepth?: number
  delayMs?: number
  format?: "text" | "markdown" | "llm"
  maxCharsPerPage?: number
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.origin === ub.origin
  } catch (err) {
      log.debugCatch("src/core/web-crawl.ts", err);
    /* malformed URL — treat as not same-origin */
    return false
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html)
  const links: string[] = []
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href")
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue
    try {
      const abs = new URL(href, baseUrl).href
      if (sameOrigin(abs, baseUrl) && !links.includes(abs)) links.push(abs)
    } catch (err) {
      log.debugCatch("src/core/web-crawl.ts", err);
      /* skip */
    }
  }
  return links
}

/** Bounded same-origin BFS crawl (WebClaw-inspired, no browser). */
export async function crawlSite(
  startUrl: string,
  opts?: CrawlOptions,
): Promise<CrawlHit[] | { error: string }> {
  const maxPages = Math.min(opts?.maxPages ?? 10, 25)
  const maxDepth = Math.min(opts?.maxDepth ?? 2, 4)
  const delayMs = opts?.delayMs ?? 200
  const format = opts?.format ?? "llm"
  const maxChars = opts?.maxCharsPerPage ?? 4000

  const visited = new Set<string>()
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }]
  const results: CrawlHit[] = []

  while (queue.length && results.length < maxPages) {
    const next = queue.shift()!
    if (visited.has(next.url)) continue
    visited.add(next.url)

    try {
      const res = await safeFetch(next.url)
      if (!res.status.toString().startsWith("2")) continue
      if (!res.contentType.includes("html")) continue

      const page = await extractFromHtml(res.body, res.finalUrl)
      const excerpt = formatForLlm(page, format, maxChars)
      results.push({ url: res.finalUrl, title: page.title || res.finalUrl, excerpt })

      if (next.depth < maxDepth) {
        for (const link of extractLinks(res.body, res.finalUrl)) {
          if (!visited.has(link)) queue.push({ url: link, depth: next.depth + 1 })
        }
      }
    } catch (err) {
      log.debugCatch("src/core/web-crawl.ts", err);
      /* skip failed page */
    }

    if (queue.length) await new Promise((r) => setTimeout(r, delayMs))
  }

  return results
}
