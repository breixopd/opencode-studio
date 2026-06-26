import { lookup } from "dns/promises"
import { BROWSER_HEADERS } from "./web-headers"

const MAX_BODY_BYTES = 10 * 1024 * 1024
const RETRY_STATUSES = new Set([429, 502, 503, 504])

const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc00:|fd00:|fe80:)/i

export type FetchFormat = "text" | "markdown" | "llm"

export interface SafeFetchResult {
  url: string
  finalUrl: string
  status: number
  contentType: string
  body: string
}

const hostLastFetch = new Map<string, number>()
const MIN_HOST_GAP_MS = 250

export function rewriteGithubBlobUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname !== "github.com") return url
    const parts = u.pathname.split("/")
    const blobIdx = parts.indexOf("blob")
    if (blobIdx < 0 || blobIdx + 2 >= parts.length) return url
    const [owner, repo, , , ...rest] = parts.slice(1)
    if (!owner || !repo) return url
    return `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join("/")}`
  } catch {
    /* not a valid URL — leave unchanged */
    return url
  }
}

export async function assertUrlSafe(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
    /* URL parse failed — rethrow with clearer message */
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`)
  }
  const host = parsed.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("localhost URLs are blocked")
  }
  const records = await lookup(host, { all: true })
  for (const r of records) {
    if (PRIVATE_IP.test(r.address)) {
      throw new Error(`Private network address blocked: ${host}`)
    }
  }
}

async function politeDelay(host: string): Promise<void> {
  const last = hostLastFetch.get(host) ?? 0
  const wait = MIN_HOST_GAP_MS - (Date.now() - last)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  hostLastFetch.set(host, Date.now())
}

async function readLimitedBody(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return await res.text()

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) throw new Error("Response body too large")
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder().decode(merged)
}

export async function safeFetch(
  rawUrl: string,
  opts?: { timeoutMs?: number; headers?: Record<string, string> },
): Promise<SafeFetchResult> {
  const url = rewriteGithubBlobUrl(rawUrl)
  await assertUrlSafe(url)
  const parsed = new URL(url)
  await politeDelay(parsed.hostname)

  const timeoutMs = opts?.timeoutMs ?? 20_000
  const headers = { ...BROWSER_HEADERS, ...opts?.headers }

  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
    try {
      const res = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok && RETRY_STATUSES.has(res.status) && attempt === 0) continue
      const contentType = res.headers.get("content-type") ?? "text/plain"
      const body = await readLimitedBody(res)
      return {
        url: rawUrl,
        finalUrl: res.url,
        status: res.status,
        contentType,
        body,
      }
    } catch (err) {
      lastErr = err as Error
      if (attempt === 0) continue
    }
  }
  throw lastErr ?? new Error("Fetch failed")
}
