import { describe, it, expect } from "bun:test"
import { grepWorkspace } from "./grep"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("studio_grep", () => {
  it("finds pattern in workspace when rg available", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-grep-"))
    try {
      writeFileSync(join(dir, "hello.ts"), "export const greet = () => 'hi'\n")
      const result = grepWorkspace("greet", dir)
      if ("error" in result) {
        expect(result.error).toContain("ripgrep")
        return
      }
      expect(result.some((h) => h.file.endsWith("hello.ts"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
