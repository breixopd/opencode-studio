/**
 * Optional semantic recall (off by default).
 *
 * When enabled (`studio_preferences set_semantic_recall true`):
 *   1. Try to load the sqlite-vec extension via `db.loadExtension` path heuristics.
 *   2. If vec is unavailable (or no embeddings stored), fall back to **enhanced FTS**
 *      "similar": token-overlap ranking of indexed chunks against the query.
 *
 * No heavy native deps are required — sqlite-vec is optional dynamic load only.
 * CI and machines without the extension always get the FTS fallback.
 */
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import type { Database } from "bun:sqlite"
import { openStudioDb, queryAll } from "./studio-db"
import { toFtsQuery } from "./code-query"
import { getSemanticRecall } from "./project-profile"
import * as log from "./logger"

/** Doctor / status reporting. */
export type SemanticRecallStatus = "off" | "vec" | "fts-fallback"

export interface SimilarChunk {
  file: string
  lineStart: number
  lineEnd: number
  content: string
  score: number
  symbolNames: string
  /** How this hit was produced */
  backend: "vec" | "fts-fallback"
}

/** Cached per-process: whether sqlite-vec loaded successfully on a given DB path. */
const vecLoaded = new Map<string, boolean>()

/** Candidate paths for the sqlite-vec loadable extension (platform-aware). */
export function sqliteVecCandidatePaths(): string[] {
  const ext =
    process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so"
  const env = process.env.STUDIO_SQLITE_VEC_PATH?.trim()
  const home = homedir()
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  const candidates = [
    env,
    // Optional npm package layouts (if user installed sqlite-vec themselves)
    join(process.cwd(), "node_modules", "sqlite-vec", `vec0.${ext}`),
    join(process.cwd(), "node_modules", "sqlite-vec", "dist", `vec0.${ext}`),
    join(process.cwd(), "node_modules", "sqlite-vec", `${process.platform}-${arch}`, `vec0.${ext}`),
    // Common system / user install locations
    join(home, ".local", "lib", `vec0.${ext}`),
    join(home, ".local", "lib", "sqlite-vec", `vec0.${ext}`),
    `/usr/local/lib/vec0.${ext}`,
    `/usr/lib/vec0.${ext}`,
    `/opt/homebrew/lib/vec0.${ext}`,
  ].filter((p): p is string => !!p && p.length > 0)
  return [...new Set(candidates)]
}

/**
 * Attempt to load sqlite-vec onto an open Database.
 * Returns true if the extension responds to a trivial probe.
 */
export function tryLoadSqliteVec(db: Database, cacheKey?: string): boolean {
  const key = cacheKey ?? "__anon__"
  const cached = vecLoaded.get(key)
  if (cached !== undefined) return cached

  let loaded = false
  for (const path of sqliteVecCandidatePaths()) {
    if (!existsSync(path)) continue
    try {
      db.loadExtension(path)
      // Probe: vec_version() or vec_length on a tiny float blob
      const row = db.prepare("SELECT vec_version() AS v").get() as { v?: string } | null
      if (row?.v) {
        loaded = true
        break
      }
    } catch (err) {
      log.debugCatch("src/core/semantic-recall.ts:loadExtension", err)
      /* try next path */
    }
  }

  // Also try bare name in case SQLite extension path is configured
  if (!loaded) {
    try {
      db.loadExtension("vec0")
      const row = db.prepare("SELECT vec_version() AS v").get() as { v?: string } | null
      if (row?.v) loaded = true
    } catch (err) {
      log.debugCatch("src/core/semantic-recall.ts:vec0", err)
    }
  }

  vecLoaded.set(key, loaded)
  return loaded
}

/** Reset load cache (tests). */
export function resetSqliteVecCache(): void {
  vecLoaded.clear()
}

/**
 * Current semantic-recall backend status for doctor / preferences show.
 * Does not require a project root when preference is off.
 */
export function getSemanticRecallStatus(root?: string): SemanticRecallStatus {
  if (!getSemanticRecall()) return "off"
  if (!root) return "fts-fallback"
  try {
    const db = openStudioDb(root)
    const dbPath = join(root, ".studio", "studio.db")
    if (tryLoadSqliteVec(db, dbPath)) return "vec"
  } catch (err) {
    log.debugCatch("src/core/semantic-recall.ts:status", err)
  }
  return "fts-fallback"
}

/** Tokenize for overlap scoring (lowercase alphanumerics, len ≥ 2). */
export function tokenizeForOverlap(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w./-]+/g, " ")
    .split(/[\s_./-]+/)
    .filter((t) => t.length >= 2)
}

/** Jaccard-ish overlap: fraction of query tokens present in text. */
export function tokenOverlapScore(queryTokens: string[], text: string): number {
  if (!queryTokens.length) return 0
  const set = new Set(tokenizeForOverlap(text))
  let hits = 0
  for (const t of queryTokens) {
    if (set.has(t)) hits++
  }
  return hits / queryTokens.length
}

/**
 * Find chunks similar to `query`.
 * Preference must be on; otherwise returns [].
 *
 * Backend:
 * - **vec** — if sqlite-vec loaded and a `chunk_embeddings` table has rows (optional future path)
 * - **fts-fallback** — FTS candidate set + token-overlap rerank (default when vec unavailable)
 */
export function similarChunks(root: string, query: string, max = 15): SimilarChunk[] {
  if (!getSemanticRecall()) return []
  const q = query.trim()
  if (!q) return []

  const db = openStudioDb(root)
  const dbPath = join(root, ".studio", "studio.db")
  const hasVec = tryLoadSqliteVec(db, dbPath)

  if (hasVec) {
    const vecHits = tryVecSimilar(db, q, max)
    if (vecHits.length) return vecHits
  }

  return ftsSimilarChunks(root, q, max)
}

/**
 * Optional KNN via chunk_embeddings(embedding float[N]) when the user has
 * populated vectors. Empty table → caller falls through to FTS.
 */
function tryVecSimilar(db: Database, query: string, max: number): SimilarChunk[] {
  try {
    const hasTable = queryOneExists(
      db,
      "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='chunk_embeddings'",
    )
    if (!hasTable) return []
    const count = queryAll<{ n: number }>(db, "SELECT COUNT(*) AS n FROM chunk_embeddings")
    if (!count[0]?.n) return []

    // Without a query embedding model we cannot do true KNN; leave the table
    // probe as the vec-ready signal and fall through. Future: embed query here.
    void query
    void max
    return []
  } catch (err) {
    log.debugCatch("src/core/semantic-recall.ts:vecSimilar", err)
    return []
  }
}

function queryOneExists(db: Database, sql: string): boolean {
  try {
    const row = db.prepare(sql).get() as { ok?: number } | null
    return !!row
  } catch {
    return false
  }
}

/**
 * Enhanced FTS "similar": pull FTS candidates (OR of terms), then rank by
 * token overlap against chunk content + symbol names.
 */
export function ftsSimilarChunks(root: string, query: string, max = 15): SimilarChunk[] {
  const queryTokens = tokenizeForOverlap(query)
  if (!queryTokens.length) return []

  const db = openStudioDb(root)
  const fts = toFtsQuery(query)
  // Build OR query for broader candidate recall than BM25 AND
  const orQuery = queryTokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ")

  type Row = {
    chunk_id: number
    file: string
    line_start: number
    line_end: number
    symbol_names: string
    content: string
  }

  let rows: Row[] = []
  try {
    rows = queryAll<Row>(
      db,
      `SELECT
         c.id AS chunk_id, f.path AS file, c.line_start, c.line_end,
         c.symbol_names, c.content
       FROM fts_chunks
       JOIN chunks c ON c.id = fts_chunks.rowid
       JOIN files f ON f.id = c.file_id
       WHERE fts_chunks MATCH ?
       LIMIT ?`,
      [orQuery || fts, Math.min(Math.max(max * 8, 40), 200)],
    )
  } catch (err) {
    log.debugCatch("src/core/semantic-recall.ts:ftsMatch", err)
    // Fallback: scan recent chunks if FTS MATCH fails
    rows = queryAll<Row>(
      db,
      `SELECT
         c.id AS chunk_id, f.path AS file, c.line_start, c.line_end,
         c.symbol_names, c.content
       FROM chunks c
       JOIN files f ON f.id = c.file_id
       ORDER BY c.id DESC
       LIMIT ?`,
      [200],
    )
  }

  const scored = rows
    .map((r) => {
      const text = `${r.symbol_names}\n${r.content}`
      const score = tokenOverlapScore(queryTokens, text)
      return {
        file: r.file,
        lineStart: r.line_start,
        lineEnd: r.line_end,
        content: r.content,
        score,
        symbolNames: r.symbol_names,
        backend: "fts-fallback" as const,
      }
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, max)
}
