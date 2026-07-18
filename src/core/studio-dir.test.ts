import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { clearActiveDirectory, setActiveDirectory } from "./active-dir"
import { studioPath, studioRoot, ensureStudioDirs } from "./studio-dir"

describe("studio-dir", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-dir-"))
    setActiveDirectory(dir)
  })

  afterEach(() => {
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
  })

  it("studioPath joins under .studio", () => {
    ensureStudioDirs(dir)
    const p = studioPath("cache", "abc.txt")
    expect(p).toBe(join(studioRoot(dir), "cache", "abc.txt"))
  })

  it("studioPath rejects path traversal", () => {
    ensureStudioDirs(dir)
    expect(() => studioPath("..", "escape.txt")).toThrow(/escapes/)
    expect(() => studioPath("cache", "..", "..", "etc", "passwd")).toThrow(/escapes/)
  })
})
