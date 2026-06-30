/**
 * Query layer over SQLite code index.
 *
 * All functions return ranges (file:line_start:line_end), never whole files.
 * Token-budget-aware retrieval caps total tokens returned per call.
 */
import { openStudioDb, queryAll } from "./studio-db"

const DEFAULT_BUDGET_TOKENS = 8000
const MAX_FTS_HITS = 50

export interface ChunkHit {
  chunkId: number
  file: string
  lineStart: number
  lineEnd: number
  symbolNames: string
  tokenEst: number
  score: number
  content: string
}

export interface SymbolHit {
  symbolId: number
  name: string
  kind: string
  file: string
  lineStart: number
  lineEnd: number
  signature: string | null
  qualified: string | null
  inDegree: number
}

export interface RefHit {
  edgeId: number
  edgeType: string
  resolved: boolean
  srcSymbol: { id: number; name: string; kind: string } | null
  dstSymbol: { id: number; name: string; kind: string } | null
  dstName: string | null
  file: string
  line: number | null
}

export interface ImporterHit {
  importerFile: string
  line: number
  names: string
}

export interface ImpactHit {
  symbolId: number
  name: string
  kind: string
  file: string
  lineStart: number
  depth: number
  callerCount: number
}

/** Split camelCase / PascalCase / snake_case into FTS5 query terms. */
export function toFtsQuery(query: string): string {
  // Strip shell-style operators a user might paste; keep letters, digits, _, .
  const cleaned = query.replace(/[^\w./-]+/g, " ").trim()
  if (!cleaned) return ""

  const parts: string[] = []
  for (const token of cleaned.split(/\s+/)) {
    // Split camelCase / PascalCase
    const split = token
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_.\-/]+/)
      .filter((t) => t.length >= 2)
      .map((t) => t.toLowerCase())
    if (split.length === 0) continue
    // Quote each term so FTS treats it literally (no OR/AND surprises)
    parts.push(split.map((t) => `"${t}"`).join(" "))
  }
  return parts.join(" ")
}

export function searchFts(root: string, query: string, max = 20): ChunkHit[] {
  const fts = toFtsQuery(query)
  if (!fts) return []
  const db = openStudioDb(root)
  const rows = queryAll<{
    chunk_id: number
    file: string
    line_start: number
    line_end: number
    symbol_names: string
    token_est: number
    content: string
    score: number
  }>(
    db,
    `SELECT
       c.id AS chunk_id, f.path AS file, c.line_start, c.line_end,
       c.symbol_names, c.token_est, c.content,
       bm25(fts_chunks) AS score
     FROM fts_chunks
     JOIN chunks c ON c.id = fts_chunks.rowid
     JOIN files f ON f.id = c.file_id
     WHERE fts_chunks MATCH ?
     ORDER BY score ASC
     LIMIT ?`,
    [fts, Math.min(max, MAX_FTS_HITS)],
  )

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    file: r.file,
    lineStart: r.line_start,
    lineEnd: r.line_end,
    symbolNames: r.symbol_names,
    tokenEst: r.token_est,
    score: r.score,
    content: r.content,
  }))
}

export function searchSymbols(
  root: string,
  name: string,
  opts?: { kind?: string; limit?: number },
): SymbolHit[] {
  const db = openStudioDb(root)
  const limit = Math.min(opts?.limit ?? 30, 100)
  const kind = opts?.kind
  // Use LIKE for prefix/substring search, fallback to exact name match
  const sql = kind
    ? `SELECT s.id, s.name, s.kind, f.path AS file, s.line_start, s.line_end,
              s.signature, s.qualified, s.in_degree
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.name LIKE ? AND s.kind = ?
       ORDER BY s.in_degree DESC, s.name LIMIT ?`
    : `SELECT s.id, s.name, s.kind, f.path AS file, s.line_start, s.line_end,
              s.signature, s.qualified, s.in_degree
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.name LIKE ?
       ORDER BY s.in_degree DESC, s.name LIMIT ?`
  const params = kind ? [`%${name}%`, kind, limit] : [`%${name}%`, limit]
  const rows = queryAll<{
    id: number
    name: string
    kind: string
    file: string
    line_start: number
    line_end: number
    signature: string | null
    qualified: string | null
    in_degree: number
  }>(db, sql, params)

  return rows.map((r) => ({
    symbolId: r.id,
    name: r.name,
    kind: r.kind,
    file: r.file,
    lineStart: r.line_start,
    lineEnd: r.line_end,
    signature: r.signature,
    qualified: r.qualified,
    inDegree: r.in_degree,
  }))
}

export function findRefs(root: string, symbolName: string, max = 50): RefHit[] {
  const db = openStudioDb(root)
  const rows = queryAll<{
    edge_id: number
    edge_type: string
    resolved: number
    src_id: number | null
    src_name: string | null
    src_kind: string | null
    dst_id: number | null
    dst_name: string | null
    dst_kind: string | null
    file: string
    line: number | null
  }>(
    db,
    `SELECT
       e.id AS edge_id, e.edge_type, e.resolved,
       src.id AS src_id, src.name AS src_name, src.kind AS src_kind,
       dst.id AS dst_id, dst.name AS dst_name, dst.kind AS dst_kind,
       e.dst_name, f.path AS file, e.line
     FROM edges e
     LEFT JOIN symbols src ON src.id = e.src_id
     LEFT JOIN symbols dst ON dst.id = e.dst_id
     JOIN files f ON f.id = e.file_id
     WHERE COALESCE(e.dst_name, '') = ? OR dst.name = ?
     ORDER BY e.resolved DESC, f.path, e.line
     LIMIT ?`,
    [symbolName, symbolName, max],
  )

  return rows.map((r) => ({
    edgeId: r.edge_id,
    edgeType: r.edge_type,
    resolved: r.resolved === 1,
    srcSymbol:
      r.src_id != null
        ? { id: r.src_id, name: r.src_name ?? "", kind: r.src_kind ?? "" }
        : null,
    dstSymbol:
      r.dst_id != null
        ? { id: r.dst_id, name: r.dst_name ?? "", kind: r.dst_kind ?? "" }
        : null,
    dstName: r.dst_name,
    file: r.file,
    line: r.line,
  }))
}

export function findImporters(root: string, file: string, max = 50): ImporterHit[] {
  const db = openStudioDb(root)
  const rows = queryAll<{ importer_file: string; line: number; names: string }>(
    db,
    `SELECT importer.path AS importer_file, i.line, i.names
     FROM imports i
     JOIN files target ON target.id = i.resolved_file_id
     JOIN files importer ON importer.id = i.file_id
     WHERE target.path = ?
     ORDER BY importer.path, i.line
     LIMIT ?`,
    [file, max],
  )

  return rows.map((r) => ({
    importerFile: r.importer_file,
    line: r.line,
    names: r.names,
  }))
}

export function findImpact(
  root: string,
  symbolName: string,
  maxDepth = 3,
  max = 50,
): ImpactHit[] {
  const db = openStudioDb(root)
  const rows = queryAll<{
    symbol_id: number
    name: string
    kind: string
    file: string
    line_start: number
    depth: number
    caller_count: number
  }>(
    db,
    `WITH RECURSIVE impact(symbol_id, depth) AS (
       SELECT id, 0 FROM symbols WHERE name = ? COLLATE NOCASE
       UNION ALL
       SELECT e.src_id, i.depth + 1
       FROM impact i
       JOIN edges e ON e.dst_id = i.symbol_id
       WHERE e.edge_type IN ('call', 'reference') AND i.depth < ?
     )
     SELECT DISTINCT
       s.id AS symbol_id, s.name, s.kind, f.path AS file, s.line_start,
       i.depth,
       (SELECT COUNT(*) FROM edges WHERE dst_id = s.id AND resolved = 1) AS caller_count
     FROM impact i
     JOIN symbols s ON s.id = i.symbol_id
     JOIN files f ON f.id = s.file_id
     WHERE i.depth > 0
     ORDER BY caller_count DESC, i.depth, s.name
     LIMIT ?`,
    [symbolName, maxDepth, max],
  )

  return rows.map((r) => ({
    symbolId: r.symbol_id,
    name: r.name,
    kind: r.kind,
    file: r.file,
    lineStart: r.line_start,
    depth: r.depth,
    callerCount: r.caller_count,
  }))
}

export interface HotspotHit {
  symbolId: number
  name: string
  kind: string
  file: string
  lineStart: number
  inDegree: number
  outDegree: number
}

export function findHotspots(root: string, max = 20): HotspotHit[] {
  const db = openStudioDb(root)
  const rows = queryAll<{
    id: number
    name: string
    kind: string
    file: string
    line_start: number
    in_degree: number
    out_degree: number
  }>(
    db,
    `SELECT s.id, s.name, s.kind, f.path AS file, s.line_start, s.in_degree, s.out_degree
     FROM symbols s JOIN files f ON f.id = s.file_id
     WHERE s.in_degree > 0
     ORDER BY s.in_degree DESC, s.out_degree DESC
     LIMIT ?`,
    [max],
  )

  return rows.map((r) => ({
    symbolId: r.id,
    name: r.name,
    kind: r.kind,
    file: r.file,
    lineStart: r.line_start,
    inDegree: r.in_degree,
    outDegree: r.out_degree,
  }))
}

export interface RetrievalPacket {
  file: string
  lineStart: number
  lineEnd: number
  symbol?: string
  score: number
  text: string
  truncated: boolean
}

/**
 * Token-budgeted retrieval — over-fetch FTS hits, rerank them heuristically,
 * then truncate the last included chunk to fit the budget. Returns ranges + truncated text.
 *
 * Rerank boosts (no new deps, pure heuristic):
 *   - Exact symbol name match > substring match
 *   - Symbol-body chunks > outline chunks
 *   - Shorter, focused chunks > sprawling ones (token efficiency)
 */
export function retrieveWithBudget(
  root: string,
  query: string,
  budgetTokens = DEFAULT_BUDGET_TOKENS,
): RetrievalPacket[] {
  const hits = searchFts(root, query, MAX_FTS_HITS)
  const queryLower = query.toLowerCase()

  // Heuristic rerank: symbol match bonus, then BM25 score (already ASC from FTS5).
  const reranked = [...hits].sort((a, b) => {
    const aExact = a.symbolNames.toLowerCase().includes(queryLower) ? 1 : 0
    const bExact = b.symbolNames.toLowerCase().includes(queryLower) ? 1 : 0
    if (aExact !== bExact) return bExact - aExact // exact match first

    const aBody = a.symbolNames ? 1 : 0
    const bBody = b.symbolNames ? 1 : 0
    if (aBody !== bBody) return bBody - aBody // symbol-body over outline

    // BM25 scores: FTS5 returns negative (lower = better), so ASC is correct.
    return a.score - b.score
  })

  const packets: RetrievalPacket[] = []
  let spent = 0

  for (const h of reranked) {
    if (spent + h.tokenEst > budgetTokens) {
      const remaining = Math.max(0, budgetTokens - spent)
      const chars = remaining * 4
      if (chars < 200) break
      const ratio = chars / h.content.length
      const endLine = h.lineStart + Math.ceil((h.lineEnd - h.lineStart) * ratio)
      packets.push({
        file: h.file,
        lineStart: h.lineStart,
        lineEnd: endLine,
        symbol: h.symbolNames || undefined,
        score: h.score,
        text: h.content.slice(0, chars) + "\n… [truncated]",
        truncated: true,
      })
      break
    }
    packets.push({
      file: h.file,
      lineStart: h.lineStart,
      lineEnd: h.lineEnd,
      symbol: h.symbolNames || undefined,
      score: h.score,
      text: h.content,
      truncated: false,
    })
    spent += h.tokenEst
  }

  return packets
}

/** Compact multi-hop research: FTS hits + top symbol refs + importers. */
export function researchCodebaseSqlite(
  root: string,
  query: string,
  opts?: { max?: number },
): string {
  const lines: string[] = []
  const ftsHits = retrieveWithBudget(root, query, opts?.max ?? DEFAULT_BUDGET_TOKENS)

  if (ftsHits.length === 0) {
    return `# Codebase research: "${query}"\n\nNo FTS matches found. Try a different query or rebuild index.`
  }

  lines.push(`# Codebase research: "${query}"`)
  lines.push("")
  lines.push(`## Matching chunks (${ftsHits.length})`)
  for (const h of ftsHits) {
    const trunc = h.truncated ? " [truncated]" : ""
    lines.push(
      `### ${h.file}:${h.lineStart}-${h.lineEnd}${h.symbol ? ` (${h.symbol})` : ""}${trunc}`,
    )
    lines.push("```")
    lines.push(h.text)
    lines.push("```")
    lines.push("")
  }

  // Pick top 3 distinct symbols from hits and show refs
  const symbols = new Set<string>()
  for (const h of ftsHits) if (h.symbol) symbols.add(h.symbol)
  const top = [...symbols].slice(0, 3)

  if (top.length > 0) {
    lines.push("## References")
    for (const sym of top) {
      const refs = findRefs(root, sym, 10)
      if (refs.length === 0) continue
      lines.push(`### ${sym} — ${refs.length} refs`)
      for (const r of refs.slice(0, 8)) {
        const lineStr = r.line ? `:${r.line}` : ""
        lines.push(`- ${r.file}${lineStr} (${r.edgeType})`)
      }
      lines.push("")
    }
  }

  // Importers for first hit's file
  if (ftsHits[0]) {
    const importers = findImporters(root, ftsHits[0].file, 10)
    if (importers.length > 0) {
      lines.push(`## Importers of ${ftsHits[0].file}`)
      for (const i of importers) {
        lines.push(`- ${i.importerFile}:${i.line}${i.names ? ` (imports: ${i.names})` : ""}`)
      }
    }
  }

  return lines.join("\n")
}

export function listSymbolsInFile(root: string, file: string): SymbolHit[] {
  const db = openStudioDb(root)
  const rows = queryAll<{
    id: number
    name: string
    kind: string
    file: string
    line_start: number
    line_end: number
    signature: string | null
    qualified: string | null
    in_degree: number
  }>(
    db,
    `SELECT s.id, s.name, s.kind, f.path AS file, s.line_start, s.line_end,
            s.signature, s.qualified, s.in_degree
     FROM symbols s JOIN files f ON f.id = s.file_id
     WHERE f.path = ?
     ORDER BY s.line_start`,
    [file],
  )

  return rows.map((r) => ({
    symbolId: r.id,
    name: r.name,
    kind: r.kind,
    file: r.file,
    lineStart: r.line_start,
    lineEnd: r.line_end,
    signature: r.signature,
    qualified: r.qualified,
    inDegree: r.in_degree,
  }))
}
