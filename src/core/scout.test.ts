import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { detectAutonomyIntent, formatScoutReport, collectSecurityFindings, collectDepsFindings, type ScoutFinding } from "./scout"
import { setAutonomyMode, getAutonomyMode, clearAutonomyFullRisk } from "./project-profile"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { execSync } from "child_process"

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
    clearAutonomyFullRisk()
    setAutonomyMode("suggest")
  })

  it("persists autonomy mode", () => {
    expect(setAutonomyMode("off")).toBe("off")
    expect(getAutonomyMode()).toBe("off")
    setAutonomyMode("suggest")
  })

  it("requires risk accept for full", () => {
    expect(() => setAutonomyMode("full")).toThrow()
    expect(setAutonomyMode("full", { acceptRisk: true })).toBe("full")
    clearAutonomyFullRisk()
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

describe("collectSecurityFindings", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scout-sec-"))
    execSync("git init", { cwd: dir, stdio: "ignore" })
    execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" })
    execSync("git config user.name Test", { cwd: dir, stdio: "ignore" })
    mkdirSync(join(dir, "src"), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("flags .env tracked by git", () => {
    writeFileSync(join(dir, ".env"), "SECRET=1\n")
    execSync("git add .env && git commit -m env", { cwd: dir, stdio: "ignore" })
    const out: ScoutFinding[] = []
    collectSecurityFindings(out, dir)
    expect(out.some((f) => f.id === "sec-env-tracked")).toBe(true)
  })

  it("flags eval( in src", () => {
    writeFileSync(join(dir, "src", "bad.ts"), "export const x = eval('1+1')\n")
    const out: ScoutFinding[] = []
    collectSecurityFindings(out, dir)
    expect(out.some((f) => f.id === "sec-eval" && f.detail.includes("bad.ts"))).toBe(true)
  })

  it("flags shell:true child_process usage", () => {
    writeFileSync(
      join(dir, "src", "run.ts"),
      `import { spawn } from "child_process"\nspawn("ls", { shell: true })\n`,
    )
    const out: ScoutFinding[] = []
    collectSecurityFindings(out, dir)
    expect(out.some((f) => f.id === "sec-shell-true")).toBe(true)
  })

  it("ignores clean src", () => {
    writeFileSync(join(dir, "src", "ok.ts"), "export const n = 1\n")
    const out: ScoutFinding[] = []
    collectSecurityFindings(out, dir)
    expect(out).toHaveLength(0)
  })
})

describe("collectDepsFindings", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scout-deps-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("flags missing lockfile", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", dependencies: { lodash: "^4.0.0" } }))
    const out: ScoutFinding[] = []
    collectDepsFindings(out, dir)
    expect(out.some((f) => f.id === "deps-no-lockfile")).toBe(true)
  })

  it("flags historically risky packages", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", dependencies: { "event-stream": "3.3.4" } }),
    )
    writeFileSync(join(dir, "package-lock.json"), "{}")
    const out: ScoutFinding[] = []
    collectDepsFindings(out, dir)
    expect(out.some((f) => f.id === "deps-risky")).toBe(true)
  })

  it("is quiet when lockfile exists and deps look fine", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", dependencies: { zod: "^3.0.0" } }))
    writeFileSync(join(dir, "bun.lock"), "# lock\n")
    const out: ScoutFinding[] = []
    collectDepsFindings(out, dir)
    expect(out).toHaveLength(0)
  })
})
