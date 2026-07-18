import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { execSync } from "child_process"
import { clearActiveDirectory, setActiveDirectory } from "./active-dir"
import { closeStudioDb } from "./studio-db"
import {
  snapshotHead,
  loadSnapshot,
  saveSnapshot,
  clearSnapshot,
  rollbackToSnapshot,
  checkGrindHealth,
  grindContextBlock,
} from "./self-heal"

describe("self-heal", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-heal-"))
    setActiveDirectory(dir)
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
    closeStudioDb(dir)
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
  })

  it("snapshotHead returns a snapshot with commit hash", async () => {
    const snap = await snapshotHead(dir)
    if (snap) {
      expect(snap.commitHash).toHaveLength(40)
      expect(snap.branch).toBeDefined()
      expect(snap.createdAt).toBeDefined()
    }
  })

  it("snapshotHead persists to .studio/self-heal-snapshot.json", async () => {
    const snap = await snapshotHead(dir)
    if (!snap) return
    const path = join(dir, ".studio", "self-heal-snapshot.json")
    expect(existsSync(path)).toBe(true)
    const loaded = JSON.parse(readFileSync(path, "utf-8"))
    expect(loaded.commitHash).toBe(snap.commitHash)
    expect(loaded.branch).toBe(snap.branch)
    expect(loadSnapshot(dir)?.commitHash).toBe(snap.commitHash)
  })

  it("loadSnapshot returns null when missing or invalid", () => {
    expect(loadSnapshot(dir)).toBeNull()
    mkdirSync(join(dir, ".studio"), { recursive: true })
    writeFileSync(join(dir, ".studio", "self-heal-snapshot.json"), "{bad", "utf-8")
    expect(loadSnapshot(dir)).toBeNull()
  })

  it("rollbackToSnapshot restores the persisted hash, not HEAD~1", async () => {
    writeFileSync(join(dir, "tracked.txt"), "at-snapshot", "utf-8")
    execSync("git add tracked.txt && git commit -m snap", { cwd: dir, stdio: "ignore" })
    const snap = await snapshotHead(dir)
    if (!snap) return

    writeFileSync(join(dir, "tracked.txt"), "after-work", "utf-8")
    execSync("git add tracked.txt && git commit -m work", { cwd: dir, stdio: "ignore" })
    writeFileSync(join(dir, "tracked.txt"), "even-later", "utf-8")
    execSync("git add tracked.txt && git commit -m later", { cwd: dir, stdio: "ignore" })

    const head1 = execSync("git rev-parse HEAD~1", { cwd: dir, encoding: "utf-8" }).trim()
    expect(head1).not.toBe(snap.commitHash)

    const msg = await rollbackToSnapshot(dir, snap)
    expect(msg).toContain(snap.commitHash.slice(0, 8))
    expect(readFileSync(join(dir, "tracked.txt"), "utf-8")).toBe("at-snapshot")
    expect(loadSnapshot(dir)).toBeNull()
  })

  it("saveSnapshot / clearSnapshot round-trip", () => {
    const snap = {
      commitHash: "a".repeat(40),
      branch: "main",
      createdAt: new Date().toISOString(),
      taskId: "t1",
    }
    saveSnapshot(dir, snap)
    expect(loadSnapshot(dir)?.taskId).toBe("t1")
    clearSnapshot(dir)
    expect(loadSnapshot(dir)).toBeNull()
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
