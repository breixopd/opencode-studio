/**
 * Code store — incremental indexing into SQLite.
 *
 * Three-tier staleness check:
 *   1. CHEAPEST  — stat() mtime+size compare (skip 99% of unchanged files)
 *   2. MEDIUM    — mtime changed → sha256 to confirm (touch vs real change)
 *   3. EXPENSIVE — hash changed → re-parse with tree-sitter, atomic replace
 *
 * Split: discover (walk/findStale) + index (parse/upsert) + this orchestrator.
 */
import { cpus } from "os"
import { join } from "path"
import * as log from "./logger"
import { openStudioDb, type FileRow } from "./studio-db"
import { discover, findStale } from "./code-store-discover"
import { deleteFile, indexFile, resolveEdges } from "./code-store-index"
import { ParsePool, defaultParseWorkerCount } from "./parse-pool"

export type { DiscoveredFile, StaleSet } from "./code-store-discover"
export { discover, findStale, fileHash, MAX_FILE_BYTES } from "./code-store-discover"
export { deleteFile, indexFile, reindexFile, resolveEdges } from "./code-store-index"

export interface IndexStats {
  root: string
  dbPath: string
  parser: string
  builtAt: string
  fileCount: number
  symbolCount: number
  chunkCount: number
  edgeCount: number
  importCount: number
  added: number
  modified: number
  deleted: number
  skipped: number
  durationMs: number
  /** workers = OS threads; inline = serialized main-thread WASM */
  parseMode: "workers" | "inline"
  parseWorkers: number
}

export interface BuildOptions {
  force?: boolean
  /** Max concurrent file parses / worker count. Default: min(8, CPUs) via ParsePool. */
  concurrency?: number
}

const PROGRESS_EVERY = 50

/** Run async work over items with a fixed concurrency pool. */
export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = items.length
  if (total === 0) return
  const limit = Math.max(1, Math.min(concurrency, total))
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const i = next++
        if (i >= total) return
        await fn(items[i]!, i)
        done++
        onProgress?.(done, total)
      }
    }),
  )
}

function defaultIndexConcurrency(): number {
  return defaultParseWorkerCount() || Math.min(4, Math.max(1, cpus().length || 1))
}

export async function buildCodeIndexSqlite(
  root: string,
  opts?: BuildOptions,
): Promise<IndexStats> {
  const started = Date.now()
  const db = openStudioDb(root)
  const discovered = discover(root)
  const stale = opts?.force
    ? { added: discovered, modified: [], deleted: [], skipped: 0 }
    : findStale(db, discovered)

  for (const rel of stale.deleted) deleteFile(db, rel)

  const toIndex = [...stale.added, ...stale.modified]
  const concurrency = opts?.concurrency ?? defaultIndexConcurrency()
  const pool = await ParsePool.create(concurrency)
  try {
    if (toIndex.length > 0) {
      log.info(
        `Indexing ${toIndex.length} file(s) with concurrency=${concurrency}` +
          ` parse=${pool.mode}` +
          (stale.deleted.length ? ` (${stale.deleted.length} deleted)` : ""),
      )
      await mapPool(
        toIndex,
        concurrency,
        async (f) => {
          await indexFile(db, root, f, {
            analyze: (content, file) => pool.analyze(content, file),
          })
        },
        (done, total) => {
          if (done === total || done % PROGRESS_EVERY === 0) {
            log.info(`Index progress: ${done}/${total} files`)
          }
        },
      )
    }

    if (stale.added.length || stale.modified.length) resolveEdges(db)

    const counts = db
      .query(
        `SELECT
           (SELECT COUNT(*) FROM files) AS file_count,
           (SELECT COUNT(*) FROM symbols) AS symbol_count,
           (SELECT COUNT(*) FROM chunks) AS chunk_count,
           (SELECT COUNT(*) FROM edges) AS edge_count,
           (SELECT COUNT(*) FROM imports) AS import_count`,
      )
      .get() as {
      file_count: number
      symbol_count: number
      chunk_count: number
      edge_count: number
      import_count: number
    }

    return {
      root,
      dbPath: join(root, ".studio", "studio.db"),
      parser: pool.mode === "workers" ? "treesitter-workers" : "treesitter",
      builtAt: new Date().toISOString(),
      fileCount: counts.file_count,
      symbolCount: counts.symbol_count,
      chunkCount: counts.chunk_count,
      edgeCount: counts.edge_count,
      importCount: counts.import_count,
      added: stale.added.length,
      modified: stale.modified.length,
      deleted: stale.deleted.length,
      skipped: stale.skipped,
      durationMs: Date.now() - started,
      parseMode: pool.mode,
      parseWorkers: pool.workerCount,
    }
  } finally {
    await pool.close()
  }
}

export function getStats(root: string): {
  fileCount: number
  symbolCount: number
  chunkCount: number
  edgeCount: number
  importCount: number
  builtAt: string | null
} {
  const db = openStudioDb(root)
  const counts = db
    .query(
      `SELECT
         (SELECT COUNT(*) FROM files) AS file_count,
         (SELECT COUNT(*) FROM symbols) AS symbol_count,
         (SELECT COUNT(*) FROM chunks) AS chunk_count,
         (SELECT COUNT(*) FROM edges) AS edge_count,
         (SELECT COUNT(*) FROM imports) AS import_count,
         (SELECT MAX(indexed_at) FROM files) AS built_at`,
    )
    .get() as {
      file_count: number
      symbol_count: number
      chunk_count: number
      edge_count: number
      import_count: number
      built_at: string | null
    }
  return {
    fileCount: counts.file_count,
    symbolCount: counts.symbol_count,
    chunkCount: counts.chunk_count,
    edgeCount: counts.edge_count,
    importCount: counts.import_count,
    builtAt: counts.built_at,
  }
}

export type { FileRow }
