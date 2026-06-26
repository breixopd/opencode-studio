import { describe, it, expect, afterEach } from "bun:test"
import {
  buildCodeIndexSqlite,
  getStats,
} from "./code-store"
import { closeStudioDb } from "./studio-db"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("code-store", () => {
  let root: string

  afterEach(() => {
    if (root) {
      closeStudioDb(root)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("indexes Python file with tree-sitter", async () => {
    root = mkdtempSync(join(tmpdir(), "studio-store-"))
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src", "foo.py"), "def greet():\n    return 'hi'\nclass Bar:\n    pass\n")
    const stats = await buildCodeIndexSqlite(root, { force: true })
    expect(stats.fileCount).toBe(1)
    expect(stats.symbolCount).toBeGreaterThanOrEqual(2)
    expect(stats.chunkCount).toBeGreaterThan(0)
  })

  it("skips unchanged files on second build (mtime fast-path)", async () => {
    root = mkdtempSync(join(tmpdir(), "studio-store-"))
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src", "a.py"), "def alpha():\n    pass\n")
    await buildCodeIndexSqlite(root, { force: true })
    const stats2 = await buildCodeIndexSqlite(root)
    expect(stats2.skipped).toBe(1)
    expect(stats2.added).toBe(0)
    expect(stats2.modified).toBe(0)
  })

  it("re-indexes when file content changes", async () => {
    root = mkdtempSync(join(tmpdir(), "studio-store-"))
    mkdirSync(join(root, "src"))
    const file = join(root, "src", "b.py")
    writeFileSync(file, "def one():\n    pass\n")
    await buildCodeIndexSqlite(root, { force: true })
    writeFileSync(file, "def two():\n    pass\ndef three():\n    pass\n")
    const stats2 = await buildCodeIndexSqlite(root)
    expect(stats2.modified).toBe(1)
    const summary = getStats(root)
    expect(summary.symbolCount).toBe(2)
  })

  it("deletes removed files", async () => {
    root = mkdtempSync(join(tmpdir(), "studio-store-"))
    mkdirSync(join(root, "src"))
    const file = join(root, "src", "c.py")
    writeFileSync(file, "def gamma():\n    pass\n")
    await buildCodeIndexSqlite(root, { force: true })
    rmSync(file)
    const stats2 = await buildCodeIndexSqlite(root)
    expect(stats2.deleted).toBe(1)
    expect(getStats(root).fileCount).toBe(0)
  })
})
