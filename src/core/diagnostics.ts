/**
 * LSP diagnostics capture — real-time type/lint errors from the language server.
 *
 * OpenCode emits `lsp.client.diagnostics` events whenever the LSP detects
 * errors or warnings. We capture them into SQLite and inject active errors
 * into the session context so the agent knows about type errors without
 * running a separate typecheck command.
 *
 * studio_verify also checks diagnostics — if errors exist, verify warns
 * before blocking handoff.
 */
import type { SQLQueryBindings } from "bun:sqlite"
import { openStudioDb, queryAll, runQuery } from "./studio-db"

export interface DiagnosticEntry {
  file: string
  line: number
  col: number
  severity: string
  source: string | null
  message: string
}

export interface DiagnosticsSummary {
  errors: number
  warnings: number
  infos: number
  total: number
  byFile: Array<{ file: string; count: number; errors: number }>
}

/** Capture a batch of diagnostics (from an LSP event). Replaces per-file set. */
export function captureDiagnostics(root: string, diags: DiagnosticEntry[]): void {
  if (!diags.length) return
  const d = openStudioDb(root)
  const now = Date.now()
  const files = new Set(diags.map((diag) => diag.file))

  d.transaction(() => {
    // Clear old diagnostics for the files being updated.
    for (const file of files) {
      runQuery(d, "DELETE FROM diagnostics WHERE file = ?", [file])
    }
    // Insert new ones.
    for (const diag of diags) {
      runQuery(
        d,
        `INSERT OR IGNORE INTO diagnostics (file, line, col, severity, source, message, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [diag.file, diag.line, diag.col, diag.severity, diag.source, diag.message, now],
      )
    }
  })()
}

/** Clear diagnostics for files that were fixed (no longer in the LSP report). */
export function clearDiagnosticsForFiles(root: string, files: string[]): void {
  if (!files.length) return
  const d = openStudioDb(root)
  for (const file of files) {
    runQuery(d, "DELETE FROM diagnostics WHERE file = ?", [file])
  }
}

/** Get the current diagnostics summary. */
export function getDiagnosticsSummary(root: string): DiagnosticsSummary {
  const d = openStudioDb(root)
  const bySeverity = queryAll<{ severity: string; count: number }>(
    d,
    "SELECT severity, COUNT(*) as count FROM diagnostics GROUP BY severity",
    [],
  )
  let errors = 0, warnings = 0, infos = 0
  for (const r of bySeverity) {
    if (r.severity === "error") errors = r.count
    else if (r.severity === "warning") warnings = r.count
    else infos += r.count
  }

  const byFile = queryAll<{ file: string; count: number; errors: number }>(
    d,
    `SELECT file,
       COUNT(*) as count,
       SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END) as errors
     FROM diagnostics
     GROUP BY file
     ORDER BY errors DESC, count DESC
     LIMIT 20`,
    [],
  )

  return {
    errors,
    warnings,
    infos,
    total: errors + warnings + infos,
    byFile,
  }
}

/** Get the actual diagnostic entries (limited). */
export function getDiagnostics(root: string, severity?: string, limit = 50): DiagnosticEntry[] {
  const d = openStudioDb(root)
  const params: SQLQueryBindings[] = []
  let where = ""
  if (severity) {
    where = "WHERE severity = ?"
    params.push(severity)
  }
  const rows = queryAll<{
    file: string
    line: number
    col: number
    severity: string
    source: string | null
    message: string
  }>(
    d,
    `SELECT file, line, col, severity, source, message
     FROM diagnostics ${where}
     ORDER BY severity = 'error' DESC, file, line
     LIMIT ?`,
    [...params, limit],
  )
  return rows.map((r) => ({ ...r }))
}

/** Format a compact diagnostics block for the session context. */
export function diagnosticsContextBlock(root: string): string | null {
  const summary = getDiagnosticsSummary(root)
  if (summary.total === 0) return null

  const lines = [
    `[studio diagnostics] ${summary.errors} error(s), ${summary.warnings} warning(s)`,
  ]

  // Show top 10 errors with file:line:message — token-cheap.
  const errors = getDiagnostics(root, "error", 10)
  if (errors.length) {
    lines.push("Errors:")
    for (const e of errors) {
      lines.push(`  ${e.file}:${e.line} — ${e.message.slice(0, 120)}`)
    }
  }

  if (summary.errors === 0 && summary.warnings > 0) {
    const warnings = getDiagnostics(root, "warning", 5)
    if (warnings.length) {
      lines.push("Warnings:")
      for (const w of warnings) {
        lines.push(`  ${w.file}:${w.line} — ${w.message.slice(0, 100)}`)
      }
    }
  }

  return lines.join("\n")
}

/** Prune stale diagnostics older than maxAgeMs. */
export function pruneStaleDiagnostics(root: string, maxAgeMs = 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs
  const d = openStudioDb(root)
  const result = runQuery(d, "DELETE FROM diagnostics WHERE updated_at < ?", [cutoff])
  return result.changes
}
