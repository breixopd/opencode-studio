import * as log from "../logger"
import { getActiveDirectory } from "../active-dir"
import type { ScoutFinding } from "./types"
import { rankFindings } from "./rank"
import {
  collectVerifyFindings,
  collectDiagnosticFindings,
  collectTestGapFindings,
  collectTaskFindings,
  collectPlanFindings,
  collectHotspotFindings,
  collectProcessFindings,
  collectCiFindings,
  collectSecurityFindings,
  collectDepsFindings,
} from "./collectors"

/** Cache scout results briefly so discipline hook stays cheap. */
let cache: { at: number; root: string; findings: ScoutFinding[] } | null = null
const CACHE_MS = 45_000

export function invalidateScoutCache(): void {
  cache = null
}

export function runScout(root = getActiveDirectory(), max = 8): ScoutFinding[] {
  if (cache && cache.root === root && Date.now() - cache.at < CACHE_MS) {
    return cache.findings.slice(0, max)
  }

  const findings: ScoutFinding[] = []

  try {
    collectVerifyFindings(findings, root)
    collectDiagnosticFindings(findings, root)
    collectTestGapFindings(findings, root)
    collectTaskFindings(findings)
    collectPlanFindings(findings)
    collectHotspotFindings(findings, root)
    collectProcessFindings(findings, root)
    collectCiFindings(findings)
    collectSecurityFindings(findings, root)
    collectDepsFindings(findings, root)
  } catch (err) {
    log.debugCatch("scout.run", err)
  }

  const ranked = rankFindings(findings).slice(0, max)
  cache = { at: Date.now(), root, findings: ranked }
  return ranked
}
