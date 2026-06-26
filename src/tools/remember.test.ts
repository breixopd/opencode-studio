import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { resetWorkspaceCache } from "../core/workspace"

const { studio_remember } = await import("./remember")

const ctx: any = null!

describe("studio_remember", () => {
  let dir: string
  let prevCwd: string

  beforeEach(() => {
    prevCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), "studio-remember-tool-"))
    process.chdir(dir)
    resetWorkspaceCache()
  })

  afterEach(() => {
    process.chdir(prevCwd)
    rmSync(dir, { recursive: true, force: true })
    resetWorkspaceCache()
  })

  it("adds and lists rules via tool", async () => {
    const added = await studio_remember.execute(
      { action: "add", rule: "always lint before commit" },
      ctx,
    )
    expect(added).toContain("Project rule saved")
    const listed = await studio_remember.execute({ action: "list" }, ctx)
    expect(listed).toContain("always lint before commit")
  })

  it("requires rule for add", async () => {
    const result = await studio_remember.execute({ action: "add" }, ctx)
    expect(result).toContain("rule required")
  })
})
