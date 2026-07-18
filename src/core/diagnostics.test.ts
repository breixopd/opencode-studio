import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { clearActiveDirectory, setActiveDirectory } from "./active-dir"
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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-diag-"))
    setActiveDirectory(dir)
  })

  afterEach(() => {
    closeStudioDb(dir)
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
  })

  function makeDiag(file: string, line: number, severity: string, message: string): DiagnosticEntry {
    return { file, line, col: 1, severity, source: "ts", message }
  }

  it("captures diagnostics and summarizes them", () => {
    captureDiagnostics(dir, [
      makeDiag("src/index.ts", 10, "error", "Type 'string' is not assignable to 'number'"),
      makeDiag("src/utils.ts", 5, "warning", "Unused import"),
    ])

    const summary = getDiagnosticsSummary(dir)
    expect(summary.errors).toBe(1)
    expect(summary.warnings).toBe(1)
    expect(summary.total).toBe(2)
    expect(summary.byFile).toHaveLength(2)
  })

  it("replaces diagnostics for a file on update", () => {
    captureDiagnostics(dir, [
      makeDiag("src/a.ts", 1, "error", "Error 1"),
      makeDiag("src/b.ts", 2, "error", "Error 2"),
    ])

    // Update file a.ts — should clear old errors and set new ones.
    captureDiagnostics(dir, [makeDiag("src/a.ts", 10, "warning", "Fixed to warning")])

    const all = getDiagnostics(dir)
    const aDiags = all.filter((d) => d.file === "src/a.ts")
    expect(aDiags).toHaveLength(1)
    expect(aDiags[0].severity).toBe("warning")
    // b.ts should still have its error.
    const bDiags = all.filter((d) => d.file === "src/b.ts")
    expect(bDiags).toHaveLength(1)
    expect(bDiags[0].severity).toBe("error")
  })

  it("clears diagnostics for fixed files", () => {
    captureDiagnostics(dir, [makeDiag("src/fixed.ts", 1, "error", "Was broken")])
    clearDiagnosticsForFiles(dir, ["src/fixed.ts"])
    const summary = getDiagnosticsSummary(dir)
    expect(summary.total).toBe(0)
  })

  it("filters by severity", () => {
    captureDiagnostics(dir, [
      makeDiag("a.ts", 1, "error", "E1"),
      makeDiag("b.ts", 2, "warning", "W1"),
      makeDiag("c.ts", 3, "info", "I1"),
    ])
    const errors = getDiagnostics(dir, "error")
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe("E1")
  })

  it("generates context block with errors", () => {
    captureDiagnostics(dir, [
      makeDiag("src/main.ts", 42, "error", "Cannot find module './utils'"),
    ])
    const block = diagnosticsContextBlock(dir)
    expect(block).not.toBeNull()
    expect(block!).toContain("1 error")
    expect(block!).toContain("src/main.ts:42")
    expect(block!).toContain("Cannot find module")
  })

  it("returns null for no diagnostics", () => {
    const block = diagnosticsContextBlock(dir)
    expect(block).toBeNull()
  })

  it("prunes stale diagnostics", () => {
    // Insert an old diagnostic by manipulating updated_at.
    const db = openStudioDb(dir)
    const oldTime = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago
    runQuery(db, "INSERT INTO diagnostics (file, line, col, severity, source, message, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "old.ts", 1, 1, "warning", "ts", "stale warning", oldTime,
    ])

    const pruned = pruneStaleDiagnostics(dir, 60 * 60 * 1000)
    expect(pruned).toBe(1)
    expect(getDiagnosticsSummary(dir).total).toBe(0)
  })
})
