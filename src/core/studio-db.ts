import * as log from "./logger"
/**
 * Unified SQLite connection layer for opencode-studio.
 *
 * One DB at `.studio/studio.db` holds everything: code intelligence, workspace
 * state (plans/tasks/rules/branches/handoffs/pins/verify), the cost ledger,
 * and LSP diagnostics.
 *
 * Schema is defined in `studio-db-schema.sql` (single source of truth).
 * WAL mode + prepared statements + pragma tuning. One connection per DB held
 * for process lifetime. Schema is idempotent — safe to call on every open.
 */
import { Database, type SQLQueryBindings } from "bun:sqlite"
import { mkdirSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

export const SCHEMA_VERSION = "2"

const connections = new Map<string, Database>()
let schemaCache: string | null = null

/** Load the schema SQL from the external .sql file (single source of truth). */
function loadSchemaSql(): string {
  if (schemaCache) return schemaCache
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "studio-db-schema.sql")
  schemaCache = readFileSync(schemaPath, "utf-8")
  return schemaCache
}

export function studioDbPath(root: string): string {
  return join(root, ".studio", "studio.db")
}

export function openStudioDb(root: string): Database {
  const dbPath = studioDbPath(root)
  const existing = connections.get(dbPath)
  if (existing) return existing

  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath, { create: true })

  // Pragmas — order matters: journal_mode before others.
  db.run("PRAGMA journal_mode = WAL;")
  db.run("PRAGMA synchronous = NORMAL;")
  db.run("PRAGMA foreign_keys = ON;")
  db.run("PRAGMA temp_store = MEMORY;")
  // 256MB memory-mapped I/O — matches ROADMAP. Larger values can fail on
  // 32-bit systems or cause memory pressure on small boxes.
  db.run("PRAGMA mmap_size = 268435456;")
  // 64MB page cache.
  db.run("PRAGMA cache_size = -65536;")
  db.run("PRAGMA wal_autocheckpoint = 1000;")
  db.run("PRAGMA busy_timeout = 5000;")

  db.exec(loadSchemaSql())
  db.run(`INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?);`, [SCHEMA_VERSION])

  connections.set(dbPath, db)
  return db
}

export function closeStudioDb(rootOrDbPath: string): void {
  // Accept either a project root or a cached db path key.
  const dbPath = connections.has(rootOrDbPath) ? rootOrDbPath : studioDbPath(rootOrDbPath)
  const db = connections.get(dbPath)
  if (!db) return
  try {
    db.run("PRAGMA wal_checkpoint(TRUNCATE);")
    db.close()
  } catch (err) {
      log.debugCatch("src/core/studio-db.ts", err);
    /* best-effort cleanup */
  }
  connections.delete(dbPath)
}

export function closeAllStudioDbs(): void {
  for (const dbPath of [...connections.keys()]) closeStudioDb(dbPath)
}

process.on?.("beforeExit", () => closeAllStudioDbs())

// ——— Query helpers ———————————————————————————————
// bun:sqlite's Statement.all() / .get() use rest params under strict types,
// which rejects array-typed binding lists. These helpers accept an explicit
// array and spread it, so callers can pass `params: SQLQueryBindings[]`.

export function queryAll<Row = Record<string, unknown>>(
  db: Database,
  sql: string,
  params: SQLQueryBindings[] = [],
): Row[] {
  return db.prepare(sql).all(...params) as Row[]
}

export function queryOne<Row = Record<string, unknown>>(
  db: Database,
  sql: string,
  params: SQLQueryBindings[] = [],
): Row | null {
  return (db.prepare(sql).get(...params) as Row | undefined) ?? null
}

export function runQuery(
  db: Database,
  sql: string,
  params: SQLQueryBindings[] = [],
): { lastInsertRowid: number | bigint; changes: number } {
  return db.prepare(sql).run(...params) as { lastInsertRowid: number | bigint; changes: number }
}

// ——— Row types ———————————————————————————————

export interface FileRow {
  id: number
  path: string
  lang: string | null
  size_bytes: number
  mtime_ns: number
  sha256: string
  parser: string
  indexed_at: string
  is_generated: number
  symbol_count: number
  chunk_count: number
}

export interface SymbolRow {
  id: number
  file_id: number
  name: string
  qualified: string | null
  kind: string
  line_start: number
  line_end: number
  signature: string | null
  parent_id: number | null
  exported: number
  in_degree: number
  out_degree: number
}

export interface ChunkRow {
  id: number
  file_id: number
  symbol_id: number | null
  line_start: number
  line_end: number
  kind: string
  content: string
  token_est: number
  symbol_names: string
}

export interface EdgeRow {
  id: number
  edge_type: string
  src_id: number
  src_kind: string
  dst_id: number | null
  dst_name: string | null
  file_id: number
  line: number | null
  resolved: number
}

export interface ImportRow {
  id: number
  file_id: number
  source: string
  resolved_file_id: number | null
  line: number
  names: string
}
