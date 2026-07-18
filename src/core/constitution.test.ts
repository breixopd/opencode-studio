import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { clearActiveDirectory, setActiveDirectory } from "./active-dir"
import { closeStudioDb } from "./studio-db"
import {
  generateConstitution,
  writeConstitution,
  readConstitution,
  constitutionExists,
  constitutionContextBlock,
} from "./constitution"

describe("constitution", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-const-"))
    setActiveDirectory(dir)
  })

  afterEach(() => {
    closeStudioDb(dir)
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
  })

  it("constitutionExists returns false when no constitution", () => {
    expect(constitutionExists(dir)).toBe(false)
  })

  it("generateConstitution produces content with project type", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "myapp", scripts: { test: "bun test" } }))
    writeFileSync(join(dir, "bun.lock"), "{}")

    const content = generateConstitution({ root: dir })
    expect(content).toContain("Project Constitution")
    expect(content).toContain("Ecosystem:")
    expect(content).toContain("Verification")
    expect(content).toContain("Quality Rules")
  })

  it("writeConstitution writes to .studio/CONSTITUTION.md", () => {
    const content = "# Test Constitution\n\nRules here."
    const path = writeConstitution(dir, content)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, "utf-8")).toBe(content)
  })

  it("readConstitution returns content when exists", () => {
    writeConstitution(dir, "# My Constitution\n\n- Rule 1\n- Rule 2")
    const content = readConstitution(dir)
    expect(content).not.toBeNull()
    expect(content!).toContain("Rule 1")
  })

  it("readConstitution returns null when not exists", () => {
    expect(readConstitution(dir)).toBeNull()
  })

  it("constitutionContextBlock returns null when no constitution", () => {
    expect(constitutionContextBlock(dir)).toBeNull()
  })

  it("constitutionContextBlock returns truncated block when constitution exists", () => {
    const long = "# Constitution\n\n" + "- Rule line here\n".repeat(700)
    writeConstitution(dir, long)
    const block = constitutionContextBlock(dir)
    expect(block).not.toBeNull()
    expect(block!).toContain("[studio constitution]")
    expect(block!).toContain("truncated")
  })

  it("constitutionContextBlock returns full block when short", () => {
    writeConstitution(dir, "# Short Constitution\n\n- Rule 1\n- Rule 2")
    const block = constitutionContextBlock(dir)
    expect(block).not.toBeNull()
    expect(block!).toContain("Rule 1")
    expect(block!).not.toContain("truncated")
  })
})
