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
