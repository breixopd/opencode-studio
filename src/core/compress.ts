import { randomUUID } from "crypto"
import { existsSync, readFileSync } from "fs"
import { studioPath, ensureStudioDirs } from "./studio-dir"

const MIN_COMPRESS_CHARS = 3_000
// Only allow short hex ids — rejects path-traversal attempts like ../../etc/passwd.
const CACHE_ID_RE = /^[a-f0-9]{8}$/

// Track whether studio dirs have been ensured (avoids repeated mkdirSync on hot path).
let dirsEnsured = false

/**
 * Compress large tool output to a head+tail summary + disk-cached full version.
 * Uses async Bun.write to avoid blocking the event loop.
 */
export async function compressToolOutput(output: string): Promise<{ text: string; cached: boolean; id?: string }> {
  if (output.length < MIN_COMPRESS_CHARS) {
    return { text: output, cached: false }
  }

  if (!dirsEnsured) {
    ensureStudioDirs()
    dirsEnsured = true
  }
  const id = randomUUID().slice(0, 8)
  const cachePath = studioPath("cache", `${id}.txt`)
  await Bun.write(cachePath, output)

  const head = output.slice(0, 2_000)
  const tail = output.slice(-800)
  const omitted = Math.max(0, output.length - 2_800)
  const trimmed = `${head}\n\n… [${omitted} chars omitted] …\n\n${tail}`
  const note = `\n\n[studio] Compressed (${output.length} chars). Full: studio_retrieve({ id: "${id}" })`
  return { text: trimmed + note, cached: true, id }
}

export function retrieveCached(id: string): string {
  if (!CACHE_ID_RE.test(id)) throw new Error(`Invalid cache id: ${id}`)
  const path = studioPath("cache", `${id}.txt`)
  if (!existsSync(path)) throw new Error(`Cache miss: ${id}`)
  return readFileSync(path, "utf-8")
}
