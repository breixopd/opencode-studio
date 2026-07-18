import { describe, it, expect, beforeEach } from "bun:test"
import { detectAutonomyIntent, formatScoutReport, type ScoutFinding } from "./scout"
import { setAutonomyMode, getAutonomyMode } from "./project-profile"

function sampleFindings(): ScoutFinding[] {
  return [
    {
      id: "a",
      severity: "low",
      category: "polish",
      title: "Low",
      detail: "d",
      action: "x",
    },
    {
      id: "b",
      severity: "high",
      category: "verify",
      title: "High",
      detail: "d",
      action: "y",
    },
  ]
}

describe("scout autonomy intent", () => {
  it("detects opt-out phrases", () => {
    expect(detectAutonomyIntent("please don't scout anymore")).toBe("off")
    expect(detectAutonomyIntent("no autonomy please")).toBe("off")
    expect(detectAutonomyIntent("stop suggesting improvements")).toBe("off")
  })

  it("detects opt-in phrases", () => {
    expect(detectAutonomyIntent("be proactive")).toBe("full")
    expect(detectAutonomyIntent("enable scout")).toBe("full")
    expect(detectAutonomyIntent("suggest only")).toBe("suggest")
  })

  it("returns null for unrelated text", () => {
    expect(detectAutonomyIntent("fix the login bug")).toBeNull()
  })
})

describe("scout report formatting", () => {
  it("formats empty findings", () => {
    const report = formatScoutReport([], "suggest")
    expect(report).toContain("Autonomy=suggest")
    expect(report).toContain("No improvement")
  })

  it("formats findings with severity", () => {
    const report = formatScoutReport(sampleFindings(), "full")
    expect(report).toContain("[high]")
    expect(report).toContain("studio_verify")
  })
})

describe("autonomy mode preference", () => {
  beforeEach(() => {
    setAutonomyMode("suggest")
  })

  it("persists autonomy mode", () => {
    expect(setAutonomyMode("off")).toBe("off")
    expect(getAutonomyMode()).toBe("off")
    setAutonomyMode("suggest")
  })
})

describe("materializeAutoActTasks", () => {
  it("creates tagged tasks for high findings and is idempotent", () => {
    const { mkdtempSync, rmSync } = require("fs") as typeof import("fs")
    const { join } = require("path") as typeof import("path")
    const { tmpdir } = require("os") as typeof import("os")
    const { setActiveDirectory, clearActiveDirectory } = require("./active-dir") as typeof import("./active-dir")
    const { closeStudioDb } = require("./studio-db") as typeof import("./studio-db")
    const { incompleteTasks } = require("./workspace-tasks") as typeof import("./workspace-tasks")
    const { materializeAutoActTasks } = require("./scout") as typeof import("./scout")

    const dir = mkdtempSync(join(tmpdir(), "scout-auto-"))
    setActiveDirectory(dir)
    try {
      const findings = sampleFindings()
      const first = materializeAutoActTasks(findings)
      expect(first.some((t) => t.title.includes("[scout:b]"))).toBe(true)
      const second = materializeAutoActTasks(findings)
      expect(second).toHaveLength(0)
      expect(incompleteTasks().filter((t) => t.title.startsWith("[scout:b]")).length).toBe(1)
    } finally {
      clearActiveDirectory()
      closeStudioDb(dir)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
