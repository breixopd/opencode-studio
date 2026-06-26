import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  addRule,
  resetWorkspaceCache,
  savePlan,
  activatePlan,
  createTask,
  incompleteTasks,
  openBranch,
  foldBranch,
  searchMemory,
  saveHandoff,
  canHandoff,
  recordVerifySuccess,
  pinContext,
  listPinnedContext,
} from "./workspace"
import { closeStudioDb } from "./studio-db"

describe("workspace", () => {
  let dir: string
  let prevCwd: string

  beforeEach(() => {
    prevCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), "studio-ws-"))
    process.chdir(dir)
    resetWorkspaceCache()
  })

  afterEach(() => {
    process.chdir(prevCwd)
    closeStudioDb(dir)
    rmSync(dir, { recursive: true, force: true })
    resetWorkspaceCache()
  })

  it("stores rules in studio.db", () => {
    addRule("always run tests")
    expect(existsSync(join(dir, ".studio", "studio.db"))).toBe(true)
  })

  it("stores structured plans", () => {
    const plan = savePlan("auth", {
      markdown: "# Plan\n\n## Goal\nAdd auth\n\n## Architecture\nJWT\n",
    })
    expect(plan.architecture).toContain("JWT")
    activatePlan(plan.id)
  })

  it("tracks tasks", () => {
    createTask("Ship feature")
    expect(incompleteTasks()).toHaveLength(1)
  })

  it("folds branches into memory", () => {
    const branch = openBranch("Explore API", "Read docs")
    foldBranch(branch.id, "Use REST API v2")
    expect(searchMemory("REST").some((h) => h.kind === "branch")).toBe(true)
  })

  it("stores handoffs", () => {
    saveHandoff({
      summary: "Fixed sync",
      filesChanged: ["sync.ts"],
      risks: "Quote shell paths",
    })
    expect(searchMemory("sync").length).toBeGreaterThan(0)
  })

  it("gates handoff on verify", () => {
    expect(canHandoff().ok).toBe(false)
    recordVerifySuccess(["bun test"])
    expect(canHandoff().ok).toBe(true)
  })

  it("pins context", () => {
    pinContext("API uses JWT")
    expect(listPinnedContext()).toContain("API uses JWT")
  })
})
