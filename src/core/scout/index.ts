/**
 * Autonomous improvement scout — finds polish, test gaps, research opportunities,
 * and verification issues without the user asking.
 */
export type { ScoutSeverity, ScoutFinding } from "./types"
export { rankFindings } from "./rank"
export {
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
  _countCodeFiles,
} from "./collectors"
export { invalidateScoutCache, runScout } from "./run"
export {
  scoutContextBlock,
  materializeAutoActTasks,
  detectAutonomyIntent,
  formatScoutReport,
} from "./context"
