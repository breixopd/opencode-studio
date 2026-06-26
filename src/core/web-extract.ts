import type { FetchFormat } from "./web-fetch"

// linkedom's parseHTML returns a document shaped like a DOM Document, but the
// global `Document` type isn't available in Bun's type context. Use a local
// structural type so we don't depend on lib.dom.d.ts.
interface LinkedomDocument {
  title?: string
  querySelector(selector: string): { getAttribute(name: string): string | null } | null
  querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null; textContent?: string | null }>
}

// Lazy-loaded heavy deps — only imported when studio_fetch/studio_crawl runs.
let turndownInstance: { turndown(html: string): string } | null = null
let readabilityLoaded = false

async function ensureWebDeps(): Promise<void> {
  if (turndownInstance && readabilityLoaded) return
  const [turndownMod] = await Promise.all([
    import("turndown"),
    import("@mozilla/readability"),
  ])
  turndownInstance = new turndownMod.default({
    headingStyle: "atx" as const,
    codeBlockStyle: "fenced" as const,
  })
  readabilityLoaded = true
}

export interface ExtractOptions {
  format?: FetchFormat
  onlyMainContent?: boolean
  maxChars?: number
}

export interface ExtractedPage {
  title: string
  description: string
  text: string
  markdown: string
  links: Array<{ href: string; text: string }>
}

function metaContent(doc: LinkedomDocument, name: string): string {
  const el =
    doc.querySelector(`meta[name="${name}"]`) ??
    doc.querySelector(`meta[property="${name}"]`) ??
    doc.querySelector(`meta[property="og:${name}"]`)
  return el?.getAttribute("content")?.trim() ?? ""
}

function collectLinks(doc: LinkedomDocument, baseUrl: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = []
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href")
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue
    try {
      const abs = new URL(href, baseUrl).href
      const text = (a.textContent ?? "").trim().slice(0, 120)
      if (text && !out.some((l) => l.href === abs)) out.push({ href: abs, text })
      if (out.length >= 30) break
    } catch {
      /* skip bad href */
    }
  }
  return out
}

export async function extractFromHtml(
  html: string,
  pageUrl: string,
  opts?: ExtractOptions,
): Promise<ExtractedPage> {
  await ensureWebDeps()
  const { parseHTML } = await import("linkedom")
  const { Readability } = await import("@mozilla/readability")

  const onlyMain = opts?.onlyMainContent !== false
  const { document } = parseHTML(html)
  const title = document.title?.trim() || metaContent(document as LinkedomDocument, "title")
  const description = metaContent(document as LinkedomDocument, "description")

  let articleHtml = html
  let text = ""

  if (onlyMain) {
    const reader = new Readability(document, { charThreshold: 80 })
    const article = reader.parse()
    if (article?.content) {
      articleHtml = article.content
      text = article.textContent?.trim() ?? ""
    }
  }

  if (!text) text = stripHtml(articleHtml)
  const markdown = turndownInstance!.turndown(articleHtml)
  const links = collectLinks(document as LinkedomDocument, pageUrl)

  return { title, description, text, markdown, links }
}

export function formatForLlm(page: ExtractedPage, format: FetchFormat, maxChars: number): string {
  const header = [
    page.title ? `> Title: ${page.title}` : "",
    page.description ? `> Description: ${page.description}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  let body =
    format === "markdown" || format === "llm"
      ? page.markdown || page.text
      : page.text

  if (format === "llm" && page.links.length) {
    const linkBlock = page.links
      .slice(0, 15)
      .map((l) => `- ${l.text}: ${l.href}`)
      .join("\n")
    body = `${body}\n\n## Links\n${linkBlock}`
  }

  const combined = header ? `${header}\n\n${body}` : body
  if (combined.length <= maxChars) return combined
  return `${combined.slice(0, maxChars)}\n\n[truncated]`
}

export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1]))
    } catch {
      /* skip */
    }
  }
  return out
}
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
