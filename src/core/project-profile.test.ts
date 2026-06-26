import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { homedir } from "os"
import {
  loadProjectProfile,
  updateProjectBrief,
  recordMilestone,
  syncHandoffToProfile,
  projectContextBlock,
  addGlobalRule,
} from "./project-profile"

describe("project-profile", () => {
  let dir: string
  let prevCwd: string

  beforeEach(() => {
    prevCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), "studio-profile-"))
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it("creates profile on first load", () => {
    const p = loadProjectProfile()
    expect(p.rootPath).toBe(dir)
    expect(existsSync(join(homedir(), ".config", "opencode-studio", "projects", `${p.id}.json`))).toBe(
      true,
    )
  })

  it("updates brief and injects context", () => {
    updateProjectBrief({ summary: "OpenCode dev plugin", conventions: ["use bun"] })
    recordMilestone("Shipped workspace store")
    const block = projectContextBlock()
    expect(block).toContain("OpenCode dev plugin")
    expect(block).toContain("Shipped workspace store")
  })

  it("syncs handoffs to profile", () => {
    syncHandoffToProfile({
      id: "abc",
      summary: "Added security agent",
      filesChanged: ["config-inject.ts"],
      risks: "Review auth paths",
      createdAt: new Date().toISOString(),
    })
    const p = loadProjectProfile()
    expect(p.lastHandoff).toContain("security")
    expect(p.openConcerns.length).toBeGreaterThan(0)
  })

  it("stores global rules", () => {
    const rules = addGlobalRule("always run bun test")
    expect(rules).toContain("always run bun test")
    expect(projectContextBlock()).toContain("always run bun test")
  })
})
