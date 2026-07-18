import type { ScoutFinding, ScoutSeverity } from "./types"

export function rankFindings(findings: ScoutFinding[]): ScoutFinding[] {
  const weight: Record<ScoutSeverity, number> = { high: 0, medium: 1, low: 2 }
  const seen = new Set<string>()
  return findings
    .filter((f) => {
      if (seen.has(f.id)) return false
      seen.add(f.id)
      return true
    })
    .sort((a, b) => weight[a.severity] - weight[b.severity])
}
