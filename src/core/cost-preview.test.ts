import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeStudioDb } from "./studio-db"
import { estimateRunCost, costPreviewBlock } from "./cost-preview"

describe("cost-preview", () => {
  let dir: string
  let prevCwd: string

  beforeEach(() => {
    prevCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), "studio-cp-"))
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    closeStudioDb(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  it("returns null when no plan and no tasks", () => {
    const estimate = estimateRunCost(process.cwd())
    expect(estimate).toBeNull()
  })

  it("returns low-confidence estimate with no historical data", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app" }))
    // Need to create a plan for the estimate to trigger
    const { savePlan, createTask, activatePlan } = require("./workspace")
    savePlan("test-plan", { goal: "test goal", steps: [{ id: "1", action: "do thing", status: "pending" }] })
    activatePlan("test-plan")
    createTask("task 1")

    const estimate = estimateRunCost(process.cwd())
    expect(estimate).not.toBeNull()
    expect(estimate!.confidence).toBe("low")
    expect(estimate!.estimatedCostUsd).toBeGreaterThan(0)
  })

  it("costPreviewBlock returns null when no plan", () => {
    const block = costPreviewBlock(process.cwd())
    expect(block).toBeNull()
  })
})
