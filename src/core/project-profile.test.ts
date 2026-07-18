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
  setAutonomyMode,
  getAutonomyMode,
  acceptAutonomyFullRisk,
  clearAutonomyFullRisk,
  hasAcceptedAutonomyFullRisk,
  detectAutonomyRiskIntent,
  AUTONOMY_FULL_RISK_REQUIRED,
} from "./project-profile"
import { consumeStudioToast } from "./toast-bus"
import { clearActiveDirectory, setActiveDirectory } from "./active-dir"

describe("project-profile", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-profile-"))
    setActiveDirectory(dir)
  })

  afterEach(() => {
    clearActiveDirectory()
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

describe("autonomy full risk acceptance", () => {
  beforeEach(() => {
    clearAutonomyFullRisk()
    setAutonomyMode("suggest")
    consumeStudioToast() // drain any leftover
  })

  afterEach(() => {
    clearAutonomyFullRisk()
    setAutonomyMode("suggest")
    consumeStudioToast()
  })

  it("refuses full without acceptance", () => {
    expect(() => setAutonomyMode("full")).toThrow(AUTONOMY_FULL_RISK_REQUIRED)
    expect(getAutonomyMode()).toBe("suggest")
  })

  it("accepts with acceptRisk and emits toast", () => {
    expect(setAutonomyMode("full", { acceptRisk: true })).toBe("full")
    expect(hasAcceptedAutonomyFullRisk()).toBe(true)
    expect(getAutonomyMode()).toBe("full")
    const toast = consumeStudioToast()
    expect(toast?.title).toContain("Full autonomy")
    expect(toast?.variant).toBe("warning")
  })

  it("allows full after prior acceptAutonomyFullRisk", () => {
    acceptAutonomyFullRisk()
    consumeStudioToast()
    expect(setAutonomyMode("full")).toBe("full")
  })

  it("keeps acceptance when leaving full", () => {
    setAutonomyMode("full", { acceptRisk: true })
    consumeStudioToast()
    setAutonomyMode("suggest")
    expect(hasAcceptedAutonomyFullRisk()).toBe(true)
    expect(setAutonomyMode("full")).toBe("full")
  })

  it("clearAutonomyFullRisk revokes", () => {
    acceptAutonomyFullRisk()
    clearAutonomyFullRisk()
    expect(hasAcceptedAutonomyFullRisk()).toBe(false)
    expect(() => setAutonomyMode("full")).toThrow()
  })

  it("detects NL risk intents", () => {
    expect(detectAutonomyRiskIntent("I accept the risk")).toBe("accept")
    expect(detectAutonomyRiskIntent("please accept autonomy risk")).toBe("accept")
    expect(detectAutonomyRiskIntent("revoke autonomy risk now")).toBe("clear")
    expect(detectAutonomyRiskIntent("fix the bug")).toBeNull()
  })
})
