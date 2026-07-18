import * as log from "./logger"
/**
 * Code store — incremental indexing into SQLite.
 *
 * Three-tier staleness check:
 *   1. CHEAPEST  — stat() mtime+size compare (skip 99% of unchanged files)
 *   2. MEDIUM    — mtime changed → sha256 to confirm (touch vs real change)
 *   3. EXPENSIVE — hash changed → re-parse with tree-sitter, atomic replace
 */
import { createHash } from "crypto"
import { readFileSync, readdirSync, statSync } from "fs"
import { cpus } from "os"
import { join, relative } from "path"
import type { Database } from "bun:sqlite"
import { DEFAULT_EXCLUDES } from "../config/defaults"
import { isRelativePathExcluded } from "../sync/excludes"
import { analyzeWithTreeSitter, formatFileOutline, isAstSupported, extensionOf } from "./tree-sitter-parser"
import type { AstSymbol } from "./tree-sitter-parser"
import { EXT_TO_WASM } from "./tree-sitter-parser"
import { openStudioDb, queryAll, queryOne, runQuery, type FileRow } from "./studio-db"

/**
 * Code file extensions — derived from tree-sitter's EXT_TO_WASM (the single
 * source of truth for AST-capable languages) plus non-AST extras (config,
 * infra, docs) that should be indexed for search but don't have AST grammars.
 *
 * When you add a language to EXT_TO_WASM in tree-sitter-parser.ts, it
 * automatically appears here — no manual sync needed.
 */
const AST_EXTENSIONS = new Set(Object.keys(EXT_TO_WASM))
const EXTRA_INDEXED_EXTENSIONS = new Set([
  // Non-AST files that should still be indexed for full-text search
  "svelte", "astro", "ipynb", "nim", "sc", "groovy", "gradle",
  "clj", "cljs", "fs", "fsx", "vb", "lhs", "elm", "erl",
  "ps1", "bat", "r", "jl",
  "htm", "scss", "less", "sass", "ini", "cfg", "xml", "csv",
  "tf", "tfvars", "hcl", "proto", "graphql", "gql", "sol", "sql",
  "md", "rst", "txt",
])
const CODE_EXTENSIONS = new Set([...AST_EXTENSIONS, ...EXTRA_INDEXED_EXTENSIONS])

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
}

/** Extension-less files that should still be indexed as code. */
const CODE_EXTENSIONLESS = new Set([
  "Dockerfile", "Containerfile", "Makefile", "BSDmakefile", "GNUmakefile",
  "Rakefile", "Gemfile", "Procfile", "Vagrantfile", "Brewfile",
  "Justfile", "justfile",
])

const MAX_FILE_BYTES = 512_000
const EST_TOKEN_CHARS = 4

export function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12)
}

function isCodeFile(name: string): boolean {
  const ext = extensionOf(name)
  if (ext && CODE_EXTENSIONS.has(ext)) return true
  // Extensionless build files (Dockerfile, Makefile, etc.)
  if (!ext && CODE_EXTENSIONLESS.has(name)) return true
  // CMakeLists.txt is treated as .txt which is in CODE_EXTENSIONS
  return false
}

function walkFiles(dir: string, root: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (err) {
      log.debugCatch("src/core/code-store.ts", err);
    /* directory unreadable (permissions/removed) — skip */
    return
  }
  for (const name of entries) {
    const abs = join(dir, name)
    const rel = relative(root, abs).replace(/\\/g, "/")
    if (isRelativePathExcluded(rel, DEFAULT_EXCLUDES)) continue
    let st
    try {
      st = statSync(abs)
    } catch (err) {
      log.debugCatch("src/core/code-store.ts", err);
    /* file vanished between readdir and stat — skip */
      continue
    }
    if (st.isDirectory()) walkFiles(abs, root, out)
    else if (st.isFile()) {
      if (isCodeFile(name) && st.size < MAX_FILE_BYTES) out.push(abs)
    }
  }
}

interface DiscoveredFile {
  abs: string
  rel: string
  mtimeMs: number
  size: number
}

function discover(root: string): DiscoveredFile[] {
  const abs: string[] = []
  walkFiles(root, root, abs)
  const out: DiscoveredFile[] = []
  for (const a of abs) {
    const st = statSync(a)
    out.push({
      abs: a,
      rel: relative(root, a).replace(/\\/g, "/"),
      mtimeMs: st.mtimeMs,
      size: st.size,
    })
  }
  return out
}

interface StaleSet {
  added: DiscoveredFile[]
  modified: DiscoveredFile[]
  deleted: string[]
  skipped: number
}

function findStale(db: Database, discovered: DiscoveredFile[]): StaleSet {
  const known = new Map<string, { id: number; mtime_ms: number; size: number; sha: string }>()
  const rows = queryAll<{
    id: number
    path: string
    mtime_ns: number
    size_bytes: number
    sha256: string
  }>(db, "SELECT id, path, mtime_ns, size_bytes, sha256 FROM files")
  for (const r of rows)
    known.set(r.path, { id: r.id, mtime_ms: r.mtime_ns, size: r.size_bytes, sha: r.sha256 })

  const added: DiscoveredFile[] = []
  const modified: DiscoveredFile[] = []
  const seen = new Set<string>()
  let skipped = 0

  for (const f of discovered) {
    seen.add(f.rel)
    const cached = known.get(f.rel)
    if (!cached) {
      added.push(f)
    } else if (Math.floor(f.mtimeMs) === cached.mtime_ms && f.size === cached.size) {
      skipped++
    } else {
      try {
        const content = readFileSync(f.abs, "utf-8")
        if (fileHash(content) === cached.sha) {
          runQuery(db, "UPDATE files SET mtime_ns = ? WHERE id = ?", [
            Math.floor(f.mtimeMs),
            cached.id,
          ])
          skipped++
        } else {
          modified.push(f)
        }
      } catch (err) {
      log.debugCatch("src/core/code-store.ts", err);
      /* can't read file to compare hash — treat as modified */
        modified.push(f)
      }
    }
  }

  const deleted = [...known.keys()].filter((p) => !seen.has(p))
  return { added, modified, deleted, skipped }
}

interface ParsedFile {
  symbols: Array<{
    name: string
    qualified: string | null
    kind: string
    line_start: number
    line_end: number
    signature: string | null
    parent_idx: number | null
    exported: boolean
  }>
  chunks: Array<{
    symbol_idx: number | null
    line_start: number
    line_end: number
    kind: string
    content: string
    token_est: number
    symbol_names: string
  }>
  imports: Array<{ source: string; line: number; names: string }>
  edges: Array<{ edge_type: string; dst_name: string; line: number | null; symbol_idx?: number | null }>
}

function buildParsedFile(_content: string, rel: string): ParsedFile {
  const symbols: ParsedFile["symbols"] = []
  const chunks: ParsedFile["chunks"] = []
  const imports: ParsedFile["imports"] = []
  const edges: ParsedFile["edges"] = []

  if (isAstSupported(rel)) {
    // tree-sitter path (async parse done by caller; here we just shape results)
    return { symbols, chunks, imports, edges }
  }
  return { symbols, chunks, imports, edges }
}

function shapeAstResults(
  astSymbols: AstSymbol[],
  astImports: Array<{ from: string; names: string[]; line: number }>,
  content: string,
  rel: string,
): ParsedFile {
  const symbols: ParsedFile["symbols"] = []
  const chunks: ParsedFile["chunks"] = []
  const edges: ParsedFile["edges"] = []
  const nameToIdx = new Map<string, number>()

  for (const s of astSymbols) {
    const idx = symbols.length
    nameToIdx.set(s.name, idx)
    const parentIdx = s.parent ? nameToIdx.get(s.parent) ?? null : null
    symbols.push({
      name: s.name,
      qualified: s.parent ? `${s.parent}.${s.name}` : s.name,
      kind: s.kind,
      line_start: s.line,
      line_end: s.endLine,
      signature: s.signature,
      parent_idx: parentIdx,
      exported: s.exported,
    })

    const rawBody = extractLineRange(content, s.line, s.endLine)
    const body = stripChunkWhitespace(rawBody)
    chunks.push({
      symbol_idx: idx,
      line_start: s.line,
      line_end: s.endLine,
      kind: "symbol_body",
      content: body,
      token_est: Math.ceil(body.length / EST_TOKEN_CHARS),
      symbol_names: s.name,
    })

    // Edges: signature often contains references to other symbols.
    for (const ref of extractReferences(s.signature)) {
      if (ref !== s.name) {
        edges_push(edges, "reference", ref, s.line)
      }
    }
  }

  // Outline chunk — full file structure summary (small, high-value for retrieval)
  const outline = formatFileOutline({ symbols: astSymbols, imports: astImports, exports: [] }, rel)
  chunks.push({
    symbol_idx: null,
    line_start: 1,
    line_end: 1,
    kind: "outline",
    content: outline,
    token_est: Math.ceil(outline.length / EST_TOKEN_CHARS),
    symbol_names: astSymbols.map((s) => s.name).join(" "),
  })

  const importsOut: ParsedFile["imports"] = astImports.map((i) => ({
    source: i.from,
    line: i.line,
    names: i.names.join(","),
  }))
  for (const imp of astImports) {
    for (const name of imp.names) edges_push(edges, "import", name, imp.line)
  }

  return { symbols, chunks, imports: importsOut, edges }
}

function edges_push(
  arr: ParsedFile["edges"],
  edge_type: string,
  dst_name: string,
  line: number | null,
): void {
  if (dst_name && dst_name.length <= 80) arr.push({ edge_type, dst_name, line })
}

function extractLineRange(content: string, start: number, end: number): string {
  const lines = content.split("\n")
  return lines.slice(Math.max(0, start - 1), end).join("\n")
}

/**
 * Strip trailing whitespace and collapse 3+ blank lines into one.
 * Does NOT remove leading indentation — that carries semantic meaning (nesting).
 * Saves ~10-15% tokens on large chunks with trailing whitespace from auto-formatters.
 */
function stripChunkWhitespace(text: string): string {
  return text
    .replace(/[\t ]+$/gm, "") // trailing whitespace per line
    .replace(/\n{3,}/g, "\n\n") // collapse blank runs
    .trim()
}

const REF_RE = /\b[A-Z][a-zA-Z0-9_]{2,}\b/g
function extractReferences(signature: string | null): string[] {
  if (!signature) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of signature.matchAll(REF_RE)) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

function replaceFileData(
  db: Database,
  fileId: number,
  parsed: ParsedFile,
): { symbolIds: number[] } {
  const symbolIds: number[] = []

  db.transaction(() => {
    runQuery(db, "DELETE FROM chunks WHERE file_id = ?", [fileId])
    runQuery(db, "DELETE FROM symbols WHERE file_id = ?", [fileId])
    runQuery(db, "DELETE FROM edges WHERE file_id = ?", [fileId])
    runQuery(db, "DELETE FROM imports WHERE file_id = ?", [fileId])

    for (let i = 0; i < parsed.symbols.length; i++) {
      const s = parsed.symbols[i]
      const info = queryOne<{ id: number }>(
        db,
        `INSERT INTO symbols (file_id, name, qualified, kind, line_start, line_end, signature, parent_id, exported)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
        [
          fileId,
          s.name,
          s.qualified,
          s.kind,
          s.line_start,
          s.line_end,
          s.signature,
          s.parent_idx != null ? symbolIds[s.parent_idx] ?? null : null,
          s.exported ? 1 : 0,
        ],
      )!
      symbolIds.push(info.id)
    }

    for (const c of parsed.chunks) {
      const symbolId = c.symbol_idx != null ? symbolIds[c.symbol_idx] ?? null : null
      db.run(
        `INSERT INTO chunks (file_id, symbol_id, line_start, line_end, kind, content, token_est, symbol_names)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [fileId, symbolId, c.line_start, c.line_end, c.kind, c.content, c.token_est, c.symbol_names],
      )
    }

    for (const imp of parsed.imports) {
      db.run(
        `INSERT INTO imports (file_id, source, line, names) VALUES (?, ?, ?, ?)`,
        [fileId, imp.source, imp.line, imp.names],
      )
    }

    for (const e of parsed.edges) {
      const srcId = e.symbol_idx != null ? (symbolIds[e.symbol_idx] ?? null) : null
      if (srcId == null) {
        // File-level edge (imports from symbol-less files) — store without src_id
        db.run(
          `INSERT INTO edges (edge_type, src_id, src_kind, dst_id, dst_name, file_id, line, resolved)
           VALUES (?, NULL, 'file', NULL, ?, ?, ?, 0)`,
          [e.edge_type, e.dst_name, fileId, e.line],
        )
      } else {
        db.run(
          `INSERT INTO edges (edge_type, src_id, src_kind, dst_id, dst_name, file_id, line, resolved)
           VALUES (?, ?, 'symbol', NULL, ?, ?, ?, 0)`,
          [e.edge_type, srcId, e.dst_name, fileId, e.line],
        )
      }
    }

    db.run(
      "UPDATE files SET symbol_count = ?, chunk_count = ? WHERE id = ?",
      [parsed.symbols.length, parsed.chunks.length, fileId],
    )
  })()

  return { symbolIds }
}

function upsertFile(
  db: Database,
  rel: string,
  f: DiscoveredFile,
  sha: string,
  lang: string,
): number {
  const existing = queryOne<{ id: number }>(db, "SELECT id FROM files WHERE path = ?", [rel])
  if (existing) {
    runQuery(
      db,
      `UPDATE files SET lang = ?, size_bytes = ?, mtime_ns = ?, sha256 = ?, indexed_at = ?
       WHERE id = ?`,
      [lang, f.size, Math.floor(f.mtimeMs), sha, new Date().toISOString(), existing.id],
    )
    return existing.id
  }
  const info = queryOne<{ id: number }>(
    db,
    `INSERT INTO files (path, lang, size_bytes, mtime_ns, sha256, parser, indexed_at)
       VALUES (?, ?, ?, ?, ?, 'treesitter', ?)
       RETURNING id`,
    [rel, lang, f.size, Math.floor(f.mtimeMs), sha, new Date().toISOString()],
  )!
  return info.id
}

export async function indexFile(db: Database, _root: string, f: DiscoveredFile): Promise<void> {
  let content: string
  try {
    content = readFileSync(f.abs, "utf-8")
    /* file no longer exists — skip indexing */
  } catch (err) {
      log.debugCatch("src/core/code-store.ts", err);
    return
  }
  const sha = fileHash(content)
  const lang = extensionOf(f.rel) || "unknown"
  const fileId = upsertFile(db, f.rel, f, sha, lang)

  let parsed: ParsedFile
  if (isAstSupported(f.rel)) {
    const ast = await analyzeWithTreeSitter(content, f.rel)
    if (ast) {
      parsed = shapeAstResults(ast.symbols, ast.imports, content, f.rel)
    } else {
      parsed = buildParsedFile(content, f.rel)
    }
  } else {
    parsed = buildParsedFile(content, f.rel)
  }

  replaceFileData(db, fileId, parsed)
}

export function deleteFile(db: Database, rel: string): void {
  runQuery(db, "DELETE FROM files WHERE path = ?", [rel])
}

export function resolveEdges(db: Database): void {
  const tx = db.transaction(() => {
    // Symbol-to-symbol: resolve by name within repo (only unambiguous matches).
    // GROUP BY e.id (not e.dst_name) so EVERY unambiguous edge is resolved,
    // not just one per symbol name.
    db.run(`
      UPDATE edges
      SET dst_id = sub.dst_id, resolved = 1
      FROM (
        SELECT MIN(s.id) AS dst_id, e.id AS edge_id
        FROM edges e
        JOIN symbols s ON s.name = e.dst_name
        WHERE e.dst_id IS NULL
        GROUP BY e.id
        HAVING COUNT(DISTINCT s.id) = 1
      ) sub
      WHERE edges.id = sub.edge_id
    `)

    // Update in_degree on resolved targets
    db.run(`
      UPDATE symbols
      SET in_degree = (
        SELECT COUNT(*) FROM edges
        WHERE edges.dst_id = symbols.id AND edges.resolved = 1
      ),
      out_degree = (
        SELECT COUNT(*) FROM edges
        WHERE edges.src_id = symbols.id AND edges.resolved = 1
      )
    `)

    // File-to-file imports by suffix match (case-insensitive, skip node_modules)
    db.run(`
      UPDATE imports
      SET resolved_file_id = sub.file_id
      FROM (
        SELECT i.id AS import_id, f.id AS file_id
        FROM imports i
        JOIN files f ON f.path LIKE '%' || i.source
        WHERE i.resolved_file_id IS NULL
          AND i.source NOT LIKE '%node_modules%'
          AND i.source NOT LIKE '@%'
      ) sub
      WHERE imports.id = sub.import_id
    `)
  })
  tx()
}

export interface BuildOptions {
  force?: boolean
  /** Max concurrent file parses. Default: min(4, CPU count). */
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
  return Math.min(4, Math.max(1, cpus().length || 1))
}

/**
 * Incremental reindex of a single file — called by the maintenance hook on
 * file.edited events. Cheaper than a full rebuild: only re-parses the one
 * file that changed.
 */
export async function reindexFile(root: string, absPath: string): Promise<void> {
  const db = openStudioDb(root)
  let st: import("fs").Stats
  try {
    st = statSync(absPath)
  } catch (err) {
      log.debugCatch("src/core/code-store.ts", err);
    // File was deleted — remove from index.
    const rel = relative(root, absPath).replace(/\\/g, "/")
    runQuery(db, "DELETE FROM files WHERE path = ?", [rel])
    return
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return

  const discovered: DiscoveredFile = {
    abs: absPath,
    rel: relative(root, absPath).replace(/\\/g, "/"),
    size: st.size,
    mtimeMs: st.mtimeMs,
  }
  await indexFile(db, root, discovered)
  // Re-resolve edges so newly created edges get linked to their target symbols.
  resolveEdges(db)
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
  if (toIndex.length > 0) {
    log.info(
      `Indexing ${toIndex.length} file(s) with concurrency=${concurrency}` +
        (stale.deleted.length ? ` (${stale.deleted.length} deleted)` : ""),
    )
    await mapPool(toIndex, concurrency, async (f) => {
      await indexFile(db, root, f)
    }, (done, total) => {
      if (done === total || done % PROGRESS_EVERY === 0) {
        log.info(`Index progress: ${done}/${total} files`)
      }
    })
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
    parser: "treesitter",
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
