/**
 * Code intelligence public API — thin facade over the SQLite layer.
 *
 * Persistence: `.studio/studio.db` (WAL, FTS5).
 *
 * All work is delegated to:
 *   - ./code-store  (incremental indexing)
 *   - ./code-query  (FTS5 search, refs, impact, budget retrieval)
 */
import { readFileSync } from "fs"
import { join } from "path"
import { analyzeWithTreeSitter, formatFileOutline, isAstSupported } from "./tree-sitter-parser"
import type { SymbolKind } from "./code-types"
import {
  findHotspots,
  findImpact,
  findImporters,
  findRefs,
  listSymbolsInFile as listSymbolsInFileSqlite,
  retrieveWithBudget,
  researchCodebaseSqlite,
  searchSymbols as searchSymbolsSqlite,
} from "./code-query"
import {
  buildCodeIndexSqlite,
  type IndexStats,
} from "./code-store"

export type { SymbolEntry, SymbolKind, SymbolIndex } from "./code-types"

export interface CodeIndex {
  version: 4
  parser: "sqlite-fts5"
  root: string
  dbPath: string
  builtAt: string
  fileCount: number
  symbolCount: number
  chunkCount: number
  edgeCount: number
  importCount: number
}

export interface SymbolHit {
  name: string
  kind: string
  file: string
  line: number
  endLine?: number
  signature?: string | null
  exported?: boolean
}

let prefetchPromise: Promise<CodeIndex> | null = null

export async function buildCodeIndex(
  root = process.cwd(),
  force = false,
): Promise<CodeIndex> {
  const stats: IndexStats = await buildCodeIndexSqlite(root, { force })
  return {
    version: 4,
    parser: "sqlite-fts5",
    root: stats.root,
    dbPath: stats.dbPath,
    builtAt: stats.builtAt,
    fileCount: stats.fileCount,
    symbolCount: stats.symbolCount,
    chunkCount: stats.chunkCount,
    edgeCount: stats.edgeCount,
    importCount: stats.importCount,
  }
}

export function prefetchCodeIndex(root = process.cwd()): Promise<CodeIndex> {
  if (!prefetchPromise) {
    prefetchPromise = buildCodeIndex(root).catch((err) => {
      prefetchPromise = null
      throw err
    })
  }
  return prefetchPromise
}

export function searchSymbols(
  name: string,
  root = process.cwd(),
  opts?: { kind?: SymbolKind; max?: number },
): Promise<SymbolHit[]> {
  const hits = searchSymbolsSqlite(root, name, {
    kind: opts?.kind as string | undefined,
    limit: opts?.max,
  })
  return Promise.resolve(
    hits.map((h) => ({
      name: h.name,
      kind: h.kind as SymbolKind,
      file: h.file,
      line: h.lineStart,
      endLine: h.lineEnd,
      signature: h.signature,
    })),
  )
}

export function listSymbolsInFile(
  file: string,
  root = process.cwd(),
): Promise<SymbolHit[]> {
  const hits = listSymbolsInFileSqlite(root, file)
  return Promise.resolve(
    hits.map((h) => ({
      name: h.name,
      kind: h.kind as SymbolKind,
      file: h.file,
      line: h.lineStart,
      endLine: h.lineEnd,
      signature: h.signature,
    })),
  )
}

export interface SemanticHit {
  file: string
  line: number
  endLine: number
  text: string
  symbol?: string
  score: number
}

export function semanticCodeSearch(
  query: string,
  root = process.cwd(),
  opts?: { max?: number; pathPrefix?: string; rebuild?: boolean },
): Promise<SemanticHit[]> {
  const budget = (opts?.max ?? 12) * 800 // ~800 tokens per result, capped
  let packets = retrieveWithBudget(root, query, Math.min(budget, 12_000))
  if (opts?.pathPrefix) {
    packets = packets.filter((p) => p.file.startsWith(opts.pathPrefix!))
  }
  return Promise.resolve(
    packets.map((p) => ({
      file: p.file,
      line: p.lineStart,
      endLine: p.lineEnd,
      text: p.text,
      symbol: p.symbol,
      score: p.score,
    })),
  )
}

export function researchCodebase(
  query: string,
  root = process.cwd(),
  opts?: { max?: number },
): Promise<string> {
  return Promise.resolve(researchCodebaseSqlite(root, query, opts))
}

export async function outlineFile(file: string, root = process.cwd()): Promise<string> {
  const norm = file.replace(/\\/g, "/")
  const abs = join(root, norm)
  const content = readFileSync(abs, "utf-8")
  if (isAstSupported(norm)) {
    const ast = await analyzeWithTreeSitter(content, norm)
    if (ast) return formatFileOutline(ast, norm)
  }
  return `# ${norm}\n\n(no AST support for this extension)`
}

/** Graph queries — new in v2. */
export function findReferences(name: string, root = process.cwd(), max = 50) {
  return findRefs(root, name, max)
}
export function findFileImporters(file: string, root = process.cwd(), max = 50) {
  return findImporters(root, file, max)
}
export function findImpactAnalysis(name: string, root = process.cwd(), maxDepth = 3, max = 50) {
  return findImpact(root, name, maxDepth, max)
}
export function findArchitectureHotspots(root = process.cwd(), max = 20) {
  return findHotspots(root, max)
}
