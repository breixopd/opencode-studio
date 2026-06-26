import { describe, it, expect, afterEach } from "bun:test"
import { openStudioDb, closeStudioDb, SCHEMA_VERSION } from "./studio-db"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("code-db", () => {
  let root: string

  afterEach(() => {
    if (root) {
      closeStudioDb(root)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("opens db with schema + WAL + pragmas", () => {
    root = mkdtempSync(join(tmpdir(), "studio-db-"))
    const db = openStudioDb(root)
    const journal = db.query("PRAGMA journal_mode").get() as { journal_mode?: string }
    expect(journal.journal_mode).toBe("wal")
    const version = db.query("SELECT value FROM meta WHERE key='schema_version'").get() as {
      value?: string
    }
    expect(version.value).toBe(SCHEMA_VERSION)
  })

  it("cascades deletes from files to symbols/chunks/edges/imports", () => {
    root = mkdtempSync(join(tmpdir(), "studio-db-"))
    const db = openStudioDb(root)
    db.run(
      `INSERT INTO files (path, lang, size_bytes, mtime_ns, sha256, parser, indexed_at)
       VALUES ('a.ts', 'typescript', 10, 1, 'abc', 'treesitter', '2025-01-01')`,
    )
    const fileId = (db.query("SELECT id FROM files").get() as { id: number }).id
    db.run(`INSERT INTO symbols (file_id, name, kind, line_start, line_end) VALUES (?, 'x', 'function', 1, 2)`, [fileId])
    db.run(`DELETE FROM files WHERE id = ?`, [fileId])
    const symCount = (db.query("SELECT COUNT(*) as c FROM symbols").get() as { c: number }).c
    expect(symCount).toBe(0)
  })

  it("returns same connection on repeated open", () => {
    root = mkdtempSync(join(tmpdir(), "studio-db-"))
    const a = openStudioDb(root)
    const b = openStudioDb(root)
    expect(a).toBe(b)
  })
})
