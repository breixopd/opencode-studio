import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  addRememberRule,
  loadRememberRules,
  removeRememberRule,
  rememberRulesText,
} from "./remember"

describe("remember", () => {
  let dir: string
  let prevCwd: string

  beforeEach(() => {
    prevCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), "studio-remember-"))
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it("adds and lists rules", () => {
    addRememberRule("always run tests before commit")
    expect(loadRememberRules()).toEqual(["always run tests before commit"])
    expect(rememberRulesText()).toContain("always run tests")
  })

  it("deduplicates rules case-insensitively", () => {
    addRememberRule("Use Bun")
    addRememberRule("use bun")
    expect(loadRememberRules()).toHaveLength(1)
  })

  it("removes rules", () => {
    addRememberRule("rule a")
    addRememberRule("rule b")
    removeRememberRule("rule a")
    expect(loadRememberRules()).toEqual(["rule b"])
  })

  it("persists to .studio/remember.md", () => {
    addRememberRule("no any types")
    const path = join(dir, ".studio", "remember.md")
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, "utf-8")).toContain("- no any types")
  })
})
