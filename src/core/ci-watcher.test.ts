import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  truncateLog,
  extractRootCause,
  materializeCiTasks,
  formatTriageReport,
  type CITriageItem,
  type CITriageReport,
} from "./ci-watcher"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { setActiveDirectory, clearActiveDirectory } from "./active-dir"
import { closeStudioDb } from "./studio-db"
import { incompleteTasks } from "./workspace-tasks"

describe("truncateLog", () => {
  it("returns short logs unchanged", () => {
    expect(truncateLog("hello")).toBe("hello")
  })

  it("truncates long logs keeping the tail", () => {
    const long = "A".repeat(100) + "ROOT_CAUSE_HERE"
    const out = truncateLog(long, 50)
    expect(out.length).toBeLessThan(long.length)
    expect(out).toContain("ROOT_CAUSE_HERE")
    expect(out).toContain("truncated")
  })
})

describe("extractRootCause", () => {
  it("extracts TypeScript errors", () => {
    const log = [
      "Compiling...",
      "src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "Found 1 error.",
    ].join("\n")
    const cause = extractRootCause(log)
    expect(cause).toContain("error TS2322")
  })

  it("extracts jest FAIL lines", () => {
    const log = [
      "PASS src/a.test.ts",
      "FAIL src/b.test.ts",
      "  ● Auth › rejects bad token",
      "    Expected: true",
      "    Received: false",
    ].join("\n")
    const cause = extractRootCause(log)
    expect(cause).toMatch(/FAIL|●|Expected/)
  })

  it("extracts pytest FAILED lines", () => {
    const log = [
      "test_foo.py::test_bar PASSED",
      "test_baz.py::test_qux FAILED",
      "E   AssertionError: assert 1 == 2",
    ].join("\n")
    const cause = extractRootCause(log)
    expect(cause).toMatch(/FAILED|AssertionError/)
  })

  it("falls back to last errorish lines", () => {
    const log = ["ok", "something failed badly", "done"].join("\n")
    expect(extractRootCause(log)).toContain("failed")
  })
})

describe("formatTriageReport", () => {
  it("handles unavailable gh", () => {
    const report: CITriageReport = {
      available: false,
      failingCount: 0,
      items: [],
      tasksCreated: [],
      error: "gh CLI not available or not authenticated",
    }
    expect(formatTriageReport(report)).toContain("gh CLI")
  })

  it("handles green CI", () => {
    const report: CITriageReport = {
      available: true,
      failingCount: 0,
      items: [],
      tasksCreated: [],
    }
    expect(formatTriageReport(report)).toContain("No failing")
  })

  it("formats items with root cause", () => {
    const report: CITriageReport = {
      available: true,
      failingCount: 1,
      items: [
        {
          runId: "99",
          name: "CI",
          conclusion: "failure",
          url: "https://example.com/99",
          headBranch: "main",
          rootCause: "error TS2322",
          logExcerpt: "…",
        },
      ],
      tasksCreated: [],
    }
    const text = formatTriageReport(report)
    expect(text).toContain("CI")
    expect(text).toContain("error TS2322")
    expect(text).toContain("run 99")
  })
})

describe("materializeCiTasks", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ci-triage-"))
    setActiveDirectory(dir)
  })

  afterEach(() => {
    clearActiveDirectory()
    closeStudioDb(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  it("creates [ci:runId] tasks and is idempotent", () => {
    const items: CITriageItem[] = [
      {
        runId: "12345",
        name: "CI",
        conclusion: "failure",
        url: "https://example.com/12345",
        headBranch: "feat",
        rootCause: "error TS2322",
        logExcerpt: "…",
      },
    ]
    const first = materializeCiTasks(items)
    expect(first.some((t) => t.title.includes("[ci:12345]"))).toBe(true)
    const second = materializeCiTasks(items)
    expect(second).toHaveLength(0)
    expect(incompleteTasks().filter((t) => t.title.startsWith("[ci:12345]")).length).toBe(1)
  })
})
