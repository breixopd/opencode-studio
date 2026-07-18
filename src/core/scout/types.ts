export type ScoutSeverity = "high" | "medium" | "low"

export interface ScoutFinding {
  id: string
  severity: ScoutSeverity
  category: "verify" | "tests" | "polish" | "research" | "security" | "deps" | "process"
  title: string
  detail: string
  /** Suggested next action for the agent */
  action: string
}
