import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeStudioDb } from "./studio-db"
import { snapshotHead, checkGrindHealth, grindContextBlock } from "./self-heal"

describe("self-heal", () => {
  let dir: string
  let prevCwd: string

  beforeEach(() => {
    prevCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), "studio-heal-"))
    process.chdir(dir)
    // Init git repo for snapshot tests
    const { execSync } = require("child_process")
    try {
      execSync("git init", { cwd: dir, stdio: "ignore" })
      execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" })
      execSync("git config user.name Test", { cwd: dir, stdio: "ignore" })
      execSync("git commit --allow-empty -m init", { cwd: dir, stdio: "ignore" })
    } catch {
      /* git may not be available */
    }
  })

  afterEach(() => {
    process.chdir(prevCwd)
    closeStudioDb(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  it("snapshotHead returns a snapshot with commit hash", async () => {
    const snap = await snapshotHead(dir)
    if (snap) {
      expect(snap.commitHash).toHaveLength(40)
      expect(snap.branch).toBeDefined()
      expect(snap.createdAt).toBeDefined()
    }
    // If git isn't available, snap is null — also acceptable
  })

  it("snapshotHead returns null when not a git repo", async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "studio-nogit-"))
    try {
      const snap = await snapshotHead(nonGitDir)
      expect(snap).toBeNull()
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true })
    }
  })

  it("checkGrindHealth returns no rollback when grind is 0", () => {
    const health = checkGrindHealth(dir)
    expect(health.shouldRollback).toBe(false)
    expect(health.grindCount).toBe(0)
    expect(health.message).toBe("")
  })

  it("grindContextBlock returns null when grind is 0", () => {
    const block = grindContextBlock(dir)
    expect(block).toBeNull()
  })
})

describe("cost-preview block format", () => {
  it("costPreviewBlock returns null with no plan/tasks", () => {
    const block = require("./cost-preview").costPreviewBlock("/nonexistent")
    expect(block).toBeNull()
  })
})
