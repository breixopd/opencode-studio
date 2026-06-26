import { describe, it, expect } from "bun:test"
import { globWorkspace } from "./glob"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("studio_glob", () => {
  it("finds files by pattern", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-glob-"))
    try {
      mkdirSync(join(dir, "src"))
      writeFileSync(join(dir, "src", "a.ts"), "")
      writeFileSync(join(dir, "src", "b.txt"), "")
      const result = globWorkspace("**/*.ts", dir)
      expect("error" in result).toBe(false)
      if (!("error" in result)) {
        expect(result.some((h) => h.path.endsWith("a.ts"))).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
