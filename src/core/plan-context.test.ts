import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { saveArchitectureFromPlan, loadArchitectureText, loadActivePlanText } from "./plan-context"
import { saveBoulder } from "./tasks"

describe("plan-context", () => {
  let dir: string
  let prevCwd: string

  beforeEach(() => {
    prevCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), "studio-plan-ctx-"))
    process.chdir(dir)
    mkdirSync(join(dir, ".studio", "plans"), { recursive: true })
  })

  afterEach(() => {
    process.chdir(prevCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it("extracts architecture sections to architecture.md", () => {
    saveArchitectureFromPlan(`# Plan

## Goal
Build auth

## Architecture
JWT + refresh tokens

## File structure
src/auth/

## Steps
- [ ] implement
`)
    const arch = loadArchitectureText()
    expect(arch).toContain("JWT")
    expect(arch).toContain("src/auth/")
  })

  it("loads active plan from boulder state", () => {
    writeFileSync(
      join(dir, ".studio", "plans", "feature-x.md"),
      "# Plan\n\n## Goal\nDo thing\n",
      "utf-8",
    )
    saveBoulder({ activeTaskIds: [], planFile: "feature-x.md", updatedAt: new Date().toISOString() })
    const plan = loadActivePlanText()
    expect(plan?.name).toBe("feature-x.md")
    expect(plan?.content).toContain("Do thing")
  })
})
