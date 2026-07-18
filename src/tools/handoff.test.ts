import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { setActiveDirectory, clearActiveDirectory } from "../core/active-dir"
import {
  canHandoff,
  recordVerifySuccess,
  createTask,
  updateTask,
  resetWorkspaceCache,
} from "../core/workspace"
import { closeStudioDb } from "../core/studio-db"

describe("studio_handoff canHandoff gate", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-handoff-"))
    setActiveDirectory(dir)
    resetWorkspaceCache()
  })

  afterEach(() => {
    closeStudioDb(dir)
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
    resetWorkspaceCache()
  })

  it("blocks when verify has not passed", () => {
    const gate = canHandoff()
    expect(gate.ok).toBe(false)
    expect(gate.reason).toMatch(/studio_verify/)
  })

  it("allows when verify passed and no open tasks", () => {
    recordVerifySuccess(["bun test"])
    expect(canHandoff().ok).toBe(true)
  })

  it("blocks when open tasks remain even after verify", () => {
    recordVerifySuccess(["bun test"])
    const task = createTask("Finish feature")
    expect(canHandoff().ok).toBe(false)
    expect(canHandoff().reason).toMatch(/open task/)
    updateTask(task.id, { status: "done" })
    expect(canHandoff().ok).toBe(true)
  })

  it("force:true always allows", () => {
    expect(canHandoff(true).ok).toBe(true)
  })
})
