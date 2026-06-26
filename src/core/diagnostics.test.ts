import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { closeStudioDb, openStudioDb, runQuery } from "./studio-db"
import {
  captureDiagnostics,
  getDiagnostics,
  getDiagnosticsSummary,
  diagnosticsContextBlock,
  clearDiagnosticsForFiles,
  pruneStaleDiagnostics,
  type DiagnosticEntry,
} from "./diagnostics"

describe("diagnostics", () => {
  let dir: string
  let prevCwd: string

  beforeEach(() => {
    prevCwd = process.cwd()
    dir = mkdtempSync(join(tmpdir(), "studio-diag-"))
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    closeStudioDb(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  function makeDiag(file: string, line: number, severity: string, message: string): DiagnosticEntry {
    return { file, line, col: 1, severity, source: "ts", message }
  }

  it("captures diagnostics and summarizes them", () => {
    captureDiagnostics(process.cwd(), [
      makeDiag("src/index.ts", 10, "error", "Type 'string' is not assignable to 'number'"),
      makeDiag("src/utils.ts", 5, "warning", "Unused import"),
    ])

    const summary = getDiagnosticsSummary(process.cwd())
    expect(summary.errors).toBe(1)
    expect(summary.warnings).toBe(1)
    expect(summary.total).toBe(2)
    expect(summary.byFile).toHaveLength(2)
  })

  it("replaces diagnostics for a file on update", () => {
    captureDiagnostics(process.cwd(), [
      makeDiag("src/a.ts", 1, "error", "Error 1"),
      makeDiag("src/b.ts", 2, "error", "Error 2"),
    ])

    // Update file a.ts — should clear old errors and set new ones.
    captureDiagnostics(process.cwd(), [makeDiag("src/a.ts", 10, "warning", "Fixed to warning")])

    const all = getDiagnostics(process.cwd())
    const aDiags = all.filter((d) => d.file === "src/a.ts")
    expect(aDiags).toHaveLength(1)
    expect(aDiags[0].severity).toBe("warning")
    // b.ts should still have its error.
    const bDiags = all.filter((d) => d.file === "src/b.ts")
    expect(bDiags).toHaveLength(1)
    expect(bDiags[0].severity).toBe("error")
  })

  it("clears diagnostics for fixed files", () => {
    captureDiagnostics(process.cwd(), [makeDiag("src/fixed.ts", 1, "error", "Was broken")])
    clearDiagnosticsForFiles(process.cwd(), ["src/fixed.ts"])
    const summary = getDiagnosticsSummary(process.cwd())
    expect(summary.total).toBe(0)
  })

  it("filters by severity", () => {
    captureDiagnostics(process.cwd(), [
      makeDiag("a.ts", 1, "error", "E1"),
      makeDiag("b.ts", 2, "warning", "W1"),
      makeDiag("c.ts", 3, "info", "I1"),
    ])
    const errors = getDiagnostics(process.cwd(), "error")
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe("E1")
  })

  it("generates context block with errors", () => {
    captureDiagnostics(process.cwd(), [
      makeDiag("src/main.ts", 42, "error", "Cannot find module './utils'"),
    ])
    const block = diagnosticsContextBlock(process.cwd())
    expect(block).not.toBeNull()
    expect(block!).toContain("1 error")
    expect(block!).toContain("src/main.ts:42")
    expect(block!).toContain("Cannot find module")
  })

  it("returns null for no diagnostics", () => {
    const block = diagnosticsContextBlock(process.cwd())
    expect(block).toBeNull()
  })

  it("prunes stale diagnostics", () => {
    // Insert an old diagnostic by manipulating updated_at.
    const db = openStudioDb(process.cwd())
    const oldTime = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago
    runQuery(db, "INSERT INTO diagnostics (file, line, col, severity, source, message, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "old.ts", 1, 1, "warning", "ts", "stale warning", oldTime,
    ])

    const pruned = pruneStaleDiagnostics(process.cwd(), 60 * 60 * 1000)
    expect(pruned).toBe(1)
    expect(getDiagnosticsSummary(process.cwd()).total).toBe(0)
  })
})
