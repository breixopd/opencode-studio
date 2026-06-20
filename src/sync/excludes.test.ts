import { describe, it, expect } from "bun:test"
import { join } from "path"
import { isExcluded, isRelativePathExcluded } from "./excludes"

const ROOT = "/project"

describe("isExcluded", () => {
  const patterns = [".git/", "node_modules/", "*.pyc", ".env*"]

  it("ignores .git directory", () => {
    expect(isExcluded(join(ROOT, ".git", "config"), ROOT, patterns)).toBe(true)
  })

  it("ignores node_modules", () => {
    expect(isExcluded(join(ROOT, "node_modules", "pkg", "index.js"), ROOT, patterns)).toBe(true)
  })

  it("ignores *.pyc files", () => {
    expect(isExcluded(join(ROOT, "foo.pyc"), ROOT, patterns)).toBe(true)
    expect(isExcluded(join(ROOT, "foo.py"), ROOT, patterns)).toBe(false)
  })

  it("ignores .env* files", () => {
    expect(isExcluded(join(ROOT, ".env.local"), ROOT, patterns)).toBe(true)
    expect(isExcluded(join(ROOT, "env.local"), ROOT, patterns)).toBe(false)
  })

  it("does not exclude normal source files", () => {
    expect(isExcluded(join(ROOT, "src", "index.ts"), ROOT, patterns)).toBe(false)
  })
})

describe("isRelativePathExcluded", () => {
  it("matches prefix patterns", () => {
    expect(isRelativePathExcluded("vendor/lib/foo.js", ["vendor/"])).toBe(true)
  })
})
