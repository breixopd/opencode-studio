import { randomUUID } from "crypto"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { studioPath, ensureStudioDirs } from "./studio-dir"

const MIN_COMPRESS_CHARS = 3_000
const MAX_PREVIEW_ITEMS = 40

export function compressToolOutput(output: string): { text: string; cached: boolean; id?: string } {
  if (output.length < MIN_COMPRESS_CHARS) {
    return { text: output, cached: false }
  }

  ensureStudioDirs()
  const id = randomUUID().slice(0, 8)
  writeFileSync(studioPath("cache", `${id}.txt`), output, "utf-8")

  const trimmed = tryCompressJson(output) ?? truncateText(output)
  const note = `\n\n[studio] Output compressed (${output.length} → ${trimmed.length} chars). Full: studio_retrieve({ id: "${id}" })`
  return { text: trimmed + note, cached: true, id }
}

export function retrieveCached(id: string): string {
  const path = studioPath("cache", `${id}.txt`)
  if (!existsSync(path)) throw new Error(`Cache miss: ${id}`)
  return readFileSync(path, "utf-8")
}

function tryCompressJson(text: string): string | null {
  try {
    const data = JSON.parse(text)
    if (!Array.isArray(data)) return null
    if (data.length <= MAX_PREVIEW_ITEMS) return null

    const errors = data.filter((item) => looksLikeError(item))
    const head = data.slice(0, 5)
    const tail = data.slice(-3)
    const sample = pickSample(data, MAX_PREVIEW_ITEMS - head.length - tail.length - errors.length)

    const kept = [...head, ...sample, ...errors, ...tail]
    const unique = dedupeByJson(kept)

    return JSON.stringify(
      {
        _studio_compressed: true,
        total: data.length,
        shown: unique.length,
        items: unique,
      },
      null,
      2,
    )
  } catch {
    return null
  }
}

function looksLikeError(item: unknown): boolean {
  const s = JSON.stringify(item).toLowerCase()
  return /error|fail|fatal|exception/.test(s)
}

function pickSample(arr: unknown[], n: number): unknown[] {
  if (n <= 0) return []
  const step = Math.max(1, Math.floor(arr.length / n))
  const out: unknown[] = []
  for (let i = 0; i < arr.length && out.length < n; i += step) {
    out.push(arr[i])
  }
  return out
}

function dedupeByJson(items: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const item of items) {
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function truncateText(text: string): string {
  const head = text.slice(0, 2_000)
  const tail = text.slice(-800)
  return `${head}\n\n… [${text.length - 2_800} chars omitted] …\n\n${tail}`
}
