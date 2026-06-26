import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { ensureStudioGitignored } from "./gitignore"

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
    expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toContain(".studio/")
  })

  it("appends .studio/ to existing .gitignore", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf-8")
    const result = ensureStudioGitignored(dir, false)
    expect(result).toBe("added")
    const content = readFileSync(join(dir, ".gitignore"), "utf-8")
    expect(content).toContain("node_modules/")
    expect(content).toContain(".studio/")
  })

  it("also adds .opencode/agents/ when gitignoring", () => {
    ensureStudioGitignored(dir, false)
    const content = readFileSync(join(dir, ".gitignore"), "utf-8")
    expect(content).toContain(".opencode/agents/")
  })

  it("does not duplicate entries", () => {
    writeFileSync(join(dir, ".gitignore"), ".studio/\n.opencode/agents/\n", "utf-8")
    const result = ensureStudioGitignored(dir, false)
    expect(result).toBe("unchanged")
  })

  it("removes .studio/ when allowCommit is true but keeps .opencode/agents/", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.studio/\n.opencode/agents/\n", "utf-8")
    const result = ensureStudioGitignored(dir, true)
    expect(result).toBe("removed")
    const content = readFileSync(join(dir, ".gitignore"), "utf-8")
    expect(content).not.toContain(".studio/")
    expect(content).toContain("node_modules/")
    expect(content).toContain(".opencode/agents/")
  })

  it("leaves missing .gitignore alone when allowCommit", () => {
    const result = ensureStudioGitignored(dir, true)
    expect(result).toBe("unchanged")
    expect(existsSync(join(dir, ".gitignore"))).toBe(false)
  })
})
