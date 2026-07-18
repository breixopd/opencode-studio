/**
 * Session spend cap — hard stop when session $ exceeds user budget.
 * Addresses the #1 competitor complaint (runaway agent token burn).
 */
import { getCostSummary, getLastCostSessionId } from "./cost"
import { getSessionBudgetUsd } from "./project-profile"
import * as log from "./logger"

export interface BudgetStatus {
  budgetUsd: number | null
  spentUsd: number
  remainingUsd: number | null
  exceeded: boolean
  ratio: number | null
}

export function getBudgetStatus(sessionId?: string): BudgetStatus {
  const budgetUsd = getSessionBudgetUsd()
  const sid = sessionId || getLastCostSessionId() || undefined
  // Prefer current session spend; fall back to last 2h window if unknown.
  const summary = sid
    ? getCostSummary({ sessionId: sid })
    : getCostSummary({ sinceMs: 2 * 60 * 60 * 1000 })
  const spentUsd = summary.totalCost
  if (budgetUsd == null || budgetUsd <= 0) {
    return { budgetUsd: null, spentUsd, remainingUsd: null, exceeded: false, ratio: null }
  }
  const remainingUsd = Math.max(0, budgetUsd - spentUsd)
  const ratio = spentUsd / budgetUsd
  return {
    budgetUsd,
    spentUsd,
    remainingUsd,
    exceeded: spentUsd >= budgetUsd,
    ratio,
  }
}

/** Soft warning block for discipline injection (≥80% of budget). */
export function budgetContextBlock(sessionId?: string): string | null {
  const status = getBudgetStatus(sessionId)
  if (status.budgetUsd == null || status.ratio == null) return null
  if (status.ratio < 0.8) return null

  if (status.exceeded) {
    return [
      `[studio budget] SESSION BUDGET EXCEEDED: $${status.spentUsd.toFixed(4)} / $${status.budgetUsd.toFixed(2)}.`,
      `Stop expensive work. Switch to studio_preferences set_model_mode free / set_prefer_local true,`,
      `or raise budget with studio_preferences set_session_budget <usd>. Say "clear budget" to remove the cap.`,
    ].join(" ")
  }

  return [
    `[studio budget] Approaching session budget: $${status.spentUsd.toFixed(4)} / $${status.budgetUsd.toFixed(2)} (${Math.round(status.ratio * 100)}%).`,
    `Prefer cheap/local models and avoid broad research crawls.`,
  ].join(" ")
}

/** Tools blocked when over budget (read-only cheap tools still allowed). */
const EXPENSIVE_TOOLS = new Set([
  "studio_search",
  "studio_crawl",
  "studio_code_search",
  "studio_council",
  "studio_browser",
  "studio_remote",
  "studio_deps",
])

export function assertBudgetAllowsTool(tool: string, sessionId?: string): void {
  if (!EXPENSIVE_TOOLS.has(tool)) return
  const status = getBudgetStatus(sessionId)
  if (!status.exceeded || status.budgetUsd == null) return
  log.warn(`Budget block: ${tool} (spent $${status.spentUsd.toFixed(4)} / $${status.budgetUsd})`)
  throw new Error(
    `Session budget exceeded ($${status.spentUsd.toFixed(4)} / $${status.budgetUsd.toFixed(2)}). ` +
      `Blocked tool: ${tool}. Use free/local models, finish with studio_verify, or ` +
      `studio_preferences set_session_budget <higher> / set_session_budget 0 to clear.`,
  )
}
