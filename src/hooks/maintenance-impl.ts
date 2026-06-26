/**
 * Maintenance handler functions — called by the main event hook.
 *
 * file.edited: schedules a debounced incremental reindex of the changed file.
 * session.idle: runs housekeeping (prune cost events, diagnostics, WAL checkpoint).
 */
import { reindexFile } from "../core/code-store"
import { pruneOldCostEvents } from "../core/cost"
import { pruneStaleDiagnostics } from "../core/diagnostics"
import { evictStaleDedupers } from "../core/dedup-session"
import { openStudioDb } from "../core/studio-db"
import * as log from "../core/logger"

const reindexTimers = new Map<string, ReturnType<typeof setTimeout>>()
const REINDEX_DEBOUNCE_MS = 1000

const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt", "rb", "php",
  "c", "h", "cpp", "cs", "swift", "scala", "ex", "sh", "lua", "zig",
  "dart", "ml", "hs", "vue", "svelte", "mjs", "cjs",
])

/** Handle file.edited — debounced incremental reindex. */
export function handleFileEdited(filePath: string): void {
  const ext = filePath.split(".").pop()?.toLowerCase()
  if (!ext || !CODE_EXTS.has(ext)) return

  const existing = reindexTimers.get(filePath)
  if (existing) clearTimeout(existing)

  reindexTimers.set(
    filePath,
    setTimeout(async () => {
      reindexTimers.delete(filePath)
      try {
        await reindexFile(process.cwd(), filePath)
      } catch {
        /* best-effort — file may not be ready */
      }
    }, REINDEX_DEBOUNCE_MS),
  )
}

/** Handle session.idle — housekeeping. */
export function handleSessionIdle(): void {
  try {
    const root = process.cwd()

    const costPruned = pruneOldCostEvents(30)
    if (costPruned > 0) log.info(`Pruned ${costPruned} old cost event(s)`)

    const diagPruned = pruneStaleDiagnostics(root, 60 * 60 * 1000)
    if (diagPruned > 0) log.info(`Pruned ${diagPruned} stale diagnostic(s)`)

    evictStaleDedupers()

    const db = openStudioDb(root)
    db.run("PRAGMA wal_checkpoint(PASSIVE);")
  } catch {
    /* best-effort maintenance */
  }
}
