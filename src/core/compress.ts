import { randomUUID } from "crypto"
import { existsSync, readFileSync } from "fs"
import { studioPath, ensureStudioDirs } from "./studio-dir"

const MIN_COMPRESS_CHARS = 3_000
// Only allow short hex ids — rejects path-traversal attempts like ../../etc/passwd.
const CACHE_ID_RE = /^[a-f0-9]{8}$/

/** Patterns for secrets that must not land in the on-disk compress cache. */
const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END/g,
  /Bearer [A-Za-z0-9._\-]{20,}/g,
]

/** Redact known secret shapes before caching or summarizing tool output. */
export function redactSecrets(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]")
  }
  return out
}

// Track whether studio dirs have been ensured (avoids repeated mkdirSync on hot path).
let dirsEnsured = false

/**
 * Compress large tool output to a head+tail summary + disk-cached full version.
 * Uses async Bun.write to avoid blocking the event loop.
 * Secrets are redacted before the cache file is written.
 */
export async function compressToolOutput(output: string): Promise<{ text: string; cached: boolean; id?: string }> {
  if (output.length < MIN_COMPRESS_CHARS) {
    return { text: output, cached: false }
  }

  if (!dirsEnsured) {
    ensureStudioDirs()
    dirsEnsured = true
  }
  const safe = redactSecrets(output)
  const id = randomUUID().slice(0, 8)
  const cachePath = studioPath("cache", `${id}.txt`)
  await Bun.write(cachePath, safe)

  const head = safe.slice(0, 2_000)
  const tail = safe.slice(-800)
  const omitted = Math.max(0, safe.length - 2_800)
  const trimmed = `${head}\n\n… [${omitted} chars omitted] …\n\n${tail}`
  const note = `\n\n[studio] Compressed (${safe.length} chars). Full: studio_retrieve({ id: "${id}" })`
  return { text: trimmed + note, cached: true, id }
}

export function retrieveCached(id: string): string {
  if (!CACHE_ID_RE.test(id)) throw new Error(`Invalid cache id: ${id}`)
  const path = studioPath("cache", `${id}.txt`)
  if (!existsSync(path)) throw new Error(`Cache miss: ${id}`)
  return readFileSync(path, "utf-8")
}
