import * as log from "./logger"
import { lookup } from "dns/promises"

const MAX_BODY_BYTES = 10 * 1024 * 1024
const RETRY_STATUSES = new Set([429, 502, 503, 504])

const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc00:|fd00:|fe80:)/i

/** True for private/link-local/loopback, including IPv4-mapped IPv6 (::ffff:127.0.0.1). */
export function isPrivateOrLocalAddress(address: string): boolean {
  const raw = address.toLowerCase().replace(/^\[|\]$/g, "")
  if (PRIVATE_IP.test(raw)) return true
  const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (mapped?.[1]) return PRIVATE_IP.test(mapped[1])
  // Compact hex form: ::ffff:7f00:1 → 127.0.0.1
  const hexMapped = raw.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16)
    const lo = parseInt(hexMapped[2]!, 16)
    if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
      return PRIVATE_IP.test(v4)
    }
  }
  return false
}

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
    // parts = ["", "owner", "repo", "blob", "ref", "path...", "file"]
    // Keep owner, repo, ref and path: raw.githubusercontent.com/owner/repo/ref/path
    const owner = parts[1]
    const repo = parts[2]
    const ref = parts[blobIdx + 1]
    const filePath = parts.slice(blobIdx + 2).join("/")
    if (!owner || !repo || !ref || !filePath) return url
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`
  } catch (err) {
      log.debugCatch("src/core/web-fetch.ts", err);
    /* not a valid URL — leave unchanged */
    return url
  }
}

export async function assertUrlSafe(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
    /* URL parse failed — rethrow with clearer message */
  } catch (err) {
      log.debugCatch("src/core/web-fetch.ts", err);
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
    if (isPrivateOrLocalAddress(r.address)) {
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
  let url = rewriteGithubBlobUrl(rawUrl)
  await assertUrlSafe(url)
  const timeoutMs = opts?.timeoutMs ?? 20_000
  const headers = { ...BROWSER_HEADERS, ...opts?.headers }

  let lastErr: Error | null = null
  // Manual redirects so each hop is re-checked against the private-IP denylist
  // (open redirect → 169.254.169.254 is a classic SSRF bypass with redirect:"follow").
  const MAX_REDIRECTS = 5
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
    try {
      let current = url
      let retryable = false
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const parsed = new URL(current)
        await politeDelay(parsed.hostname)
        await assertUrlSafe(current)

        const res = await fetch(current, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location")
          if (!loc) throw new Error(`Redirect ${res.status} without Location`)
          current = new URL(loc, current).toString()
          continue
        }

        if (!res.ok && RETRY_STATUSES.has(res.status) && attempt === 0) {
          retryable = true
          break
        }

        const contentType = res.headers.get("content-type") ?? "text/plain"
        const body = await readLimitedBody(res)
        return {
          url: rawUrl,
          finalUrl: current,
          status: res.status,
          contentType,
          body,
        }
      }
      if (retryable) continue
      throw new Error(`Too many redirects (>${MAX_REDIRECTS})`)
    } catch (err) {
      lastErr = err as Error
      if (attempt === 0 && !/Private network|localhost|Unsupported protocol|Invalid URL/.test(lastErr.message)) {
        continue
      }
      throw lastErr
    }
  }
  throw lastErr ?? new Error("Fetch failed")
}
/** Browser-like defaults inspired by WebClaw-style extraction clients. */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
}
