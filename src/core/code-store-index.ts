import * as log from "./logger"
import { readFileSync, statSync } from "fs"
import { relative } from "path"
import type { Database } from "bun:sqlite"
import { analyzeWithTreeSitter, formatFileOutline, isAstSupported, extensionOf } from "./tree-sitter-parser"
import type { AstFileAnalysis, AstSymbol } from "./tree-sitter-parser"
import { openStudioDb, queryOne, runQuery } from "./studio-db"
import { fileHash, MAX_FILE_BYTES, type DiscoveredFile } from "./code-store-discover"

const EST_TOKEN_CHARS = 4

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

function buildParsedFile(_content: string, _rel: string): ParsedFile {
  return { symbols: [], chunks: [], imports: [], edges: [] }
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

    for (const ref of extractReferences(s.signature)) {
      if (ref !== s.name) {
        edges_push(edges, "reference", ref, s.line)
      }
    }
  }

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

function stripChunkWhitespace(text: string): string {
  return text
    .replace(/[\t ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
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

export type IndexFileOptions = {
  /** Override AST analysis (e.g. OS-thread ParsePool). */
  analyze?: (content: string, file: string) => Promise<AstFileAnalysis | null>
}

export async function indexFile(
  db: Database,
  _root: string,
  f: DiscoveredFile,
  opts?: IndexFileOptions,
): Promise<void> {
  let content: string
  try {
    content = readFileSync(f.abs, "utf-8")
  } catch (err) {
    log.debugCatch("src/core/code-store-index.ts", err)
    return
  }
  const sha = fileHash(content)
  const lang = extensionOf(f.rel) || "unknown"
  const fileId = upsertFile(db, f.rel, f, sha, lang)

  let parsed: ParsedFile
  if (isAstSupported(f.rel)) {
    const analyze = opts?.analyze ?? analyzeWithTreeSitter
    const ast = await analyze(content, f.rel)
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
    log.debugCatch("src/core/code-store-index.ts", err)
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
  resolveEdges(db)
}
