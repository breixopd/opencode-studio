import * as log from "./logger"
import { createHash } from "crypto"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"
import type { Database } from "bun:sqlite"
import { DEFAULT_EXCLUDES } from "../config/defaults"
import { isRelativePathExcluded } from "../sync/excludes"
import { extensionOf } from "./tree-sitter-parser"
import { EXT_TO_WASM } from "./tree-sitter-parser"
import { queryAll, runQuery } from "./studio-db"

/**
 * Code file extensions — derived from tree-sitter's EXT_TO_WASM (the single
 * source of truth for AST-capable languages) plus non-AST extras (config,
 * infra, docs) that should be indexed for search but don't have AST grammars.
 */
const AST_EXTENSIONS = new Set(Object.keys(EXT_TO_WASM))
const EXTRA_INDEXED_EXTENSIONS = new Set([
  "svelte", "astro", "ipynb", "nim", "sc", "groovy", "gradle",
  "clj", "cljs", "fs", "fsx", "vb", "lhs", "elm", "erl",
  "ps1", "bat", "r", "jl",
  "htm", "scss", "less", "sass", "ini", "cfg", "xml", "csv",
  "tf", "tfvars", "hcl", "proto", "graphql", "gql", "sol", "sql",
  "md", "rst", "txt",
])
const CODE_EXTENSIONS = new Set([...AST_EXTENSIONS, ...EXTRA_INDEXED_EXTENSIONS])

/** Extension-less files that should still be indexed as code. */
const CODE_EXTENSIONLESS = new Set([
  "Dockerfile", "Containerfile", "Makefile", "BSDmakefile", "GNUmakefile",
  "Rakefile", "Gemfile", "Procfile", "Vagrantfile", "Brewfile",
  "Justfile", "justfile",
])

export const MAX_FILE_BYTES = 512_000

export function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12)
}

function isCodeFile(name: string): boolean {
  const ext = extensionOf(name)
  if (ext && CODE_EXTENSIONS.has(ext)) return true
  if (!ext && CODE_EXTENSIONLESS.has(name)) return true
  return false
}

function walkFiles(dir: string, root: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (err) {
    log.debugCatch("src/core/code-store-discover.ts", err)
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
      log.debugCatch("src/core/code-store-discover.ts", err)
      continue
    }
    if (st.isDirectory()) walkFiles(abs, root, out)
    else if (st.isFile()) {
      if (isCodeFile(name) && st.size < MAX_FILE_BYTES) out.push(abs)
    }
  }
}

export interface DiscoveredFile {
  abs: string
  rel: string
  mtimeMs: number
  size: number
}

export function discover(root: string): DiscoveredFile[] {
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

export interface StaleSet {
  added: DiscoveredFile[]
  modified: DiscoveredFile[]
  deleted: string[]
  skipped: number
}

export function findStale(db: Database, discovered: DiscoveredFile[]): StaleSet {
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
        log.debugCatch("src/core/code-store-discover.ts", err)
        modified.push(f)
      }
    }
  }

  const deleted = [...known.keys()].filter((p) => !seen.has(p))
  return { added, modified, deleted, skipped }
}
