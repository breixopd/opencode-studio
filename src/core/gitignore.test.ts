import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { ensureStudioGitignored, STUDIO_GITIGNORE_ENTRY } from "./gitignore"

describe("ensureStudioGitignored", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-gitignore-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("creates .gitignore with .studio/ when missing", () => {
    const result = ensureStudioGitignored(dir, false)
    expect(result).toBe("added")
    expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toContain(STUDIO_GITIGNORE_ENTRY)
  })

  it("appends .studio/ to existing .gitignore", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf-8")
    const result = ensureStudioGitignored(dir, false)
    expect(result).toBe("added")
    const content = readFileSync(join(dir, ".gitignore"), "utf-8")
    expect(content).toContain("node_modules/")
    expect(content).toContain(STUDIO_GITIGNORE_ENTRY)
  })

  it("does not duplicate .studio/ entry", () => {
    writeFileSync(join(dir, ".gitignore"), ".studio/\n", "utf-8")
    const result = ensureStudioGitignored(dir, false)
    expect(result).toBe("unchanged")
  })

  it("removes .studio/ when allowCommit is true", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.studio/\n", "utf-8")
    const result = ensureStudioGitignored(dir, true)
    expect(result).toBe("removed")
    const content = readFileSync(join(dir, ".gitignore"), "utf-8")
    expect(content).not.toContain(".studio/")
    expect(content).toContain("node_modules/")
  })

  it("leaves missing .gitignore alone when allowCommit", () => {
    const result = ensureStudioGitignored(dir, true)
    expect(result).toBe("unchanged")
    expect(existsSync(join(dir, ".gitignore"))).toBe(false)
  })
})
