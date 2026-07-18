/**
 * Session spend cap — hard stop when session $ exceeds user budget.
 * Addresses the #1 competitor complaint (runaway agent token burn).
 *
 * Scope: tool.execute.before. When the cap is exceeded we block ALL tools
 * except ALLOWED_WHEN_OVER_BUDGET — we do NOT stop LLM turns. Soft warnings
 * (≥80%) and hard-exceed notices are injected via budgetContextBlock.
 *
 * Default budget: $5 when never set. Explicit 0/clear → unlimited (null).
 */
import { getCostSummary, getLastCostSessionId } from "./cost"
import {
  DEFAULT_SESSION_BUDGET_USD,
  getSessionBudgetUsd,
  hasExplicitBudget,
} from "./project-profile"
import * as log from "./logger"

export interface BudgetStatus {
  budgetUsd: number | null
  spentUsd: number
  remainingUsd: number | null
  exceeded: boolean
  ratio: number | null
}

/** Tools still allowed after the session budget is exceeded. */
export const ALLOWED_WHEN_OVER_BUDGET = new Set([
  "studio_cost",
  "studio_preferences",
  "studio_help",
  "studio_doctor",
  "studio_status",
  "studio_models",
  "studio_verify",
  "studio_handoff",
  "studio_retrieve",
  "studio_memory",
])

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

/** True when spend has hit/exceeded the session budget (forces free routing). */
export function shouldForceFreeRouting(sessionId?: string): boolean {
  return getBudgetStatus(sessionId).exceeded
}

/** Soft warning / hard-exceed block for discipline injection (≥80% of budget). */
export function budgetContextBlock(sessionId?: string): string | null {
  const status = getBudgetStatus(sessionId)
  if (status.budgetUsd == null || status.ratio == null) return null
  if (status.ratio < 0.8) return null

  if (status.exceeded) {
    return [
      `[studio budget] SESSION BUDGET EXCEEDED: $${status.spentUsd.toFixed(4)} / $${status.budgetUsd.toFixed(2)}.`,
      `ALL tools blocked except preferences/cost/help/doctor/status/models/verify/handoff/retrieve/memory.`,
      `Raise budget with studio_preferences set_session_budget <usd>, or set_session_budget 0 to clear.`,
      `Routing forced to free/local until budget is raised.`,
    ].join(" ")
  }

  return [
    `[studio budget] Approaching session budget: $${status.spentUsd.toFixed(4)} / $${status.budgetUsd.toFixed(2)} (${Math.round(status.ratio * 100)}%).`,
    `Prefer cheap/local models and avoid broad research crawls.`,
  ].join(" ")
}

/**
 * Throws if the session budget is exceeded.
 * Prefer assertBudgetAllowsTool for tool hooks; use this for session-level gates.
 */
export function assertBudgetAllowsSession(sessionId?: string): void {
  const status = getBudgetStatus(sessionId)
  if (!status.exceeded || status.budgetUsd == null) return
  log.warn(`Budget session block (spent $${status.spentUsd.toFixed(4)} / $${status.budgetUsd})`)
  throw new Error(
    `Session budget exceeded ($${status.spentUsd.toFixed(4)} / $${status.budgetUsd.toFixed(2)}). ` +
      `All tools blocked except preferences/cost/help/doctor/verify. ` +
      `studio_preferences set_session_budget <higher> / set_session_budget 0 to clear.`,
  )
}

/** Block non-allowlisted tools when over budget. */
export function assertBudgetAllowsTool(tool: string, sessionId?: string): void {
  const status = getBudgetStatus(sessionId)
  if (!status.exceeded || status.budgetUsd == null) return
  if (ALLOWED_WHEN_OVER_BUDGET.has(tool)) return
  log.warn(`Budget block: ${tool} (spent $${status.spentUsd.toFixed(4)} / $${status.budgetUsd})`)
  throw new Error(
    `Session budget exceeded ($${status.spentUsd.toFixed(4)} / $${status.budgetUsd.toFixed(2)}). ` +
      `Blocked tool: ${tool}. Allowed: preferences, cost, help, doctor, status, models, verify, ` +
      `handoff, retrieve, memory. Raise with studio_preferences set_session_budget <usd> ` +
      `or set_session_budget 0 to clear.`,
  )
}

/**
 * First-session prompt when the user has never confirmed a budget.
 * Soft $5 still applies until they set or disable — agent must ask once.
 */
export function budgetFirstRunPrompt(): string | null {
  if (hasExplicitBudget()) return null
  return [
    `[studio budget] FIRST RUN — session spend cap not confirmed yet.`,
    `Soft default $${DEFAULT_SESSION_BUDGET_USD} is active until you choose.`,
    `Ask the user once (before heavy work):`,
    `(A) Keep default $${DEFAULT_SESSION_BUDGET_USD} — studio_setup({ action: "onboard" }) or studio_preferences set_session_budget ${DEFAULT_SESSION_BUDGET_USD}`,
    `(B) Set a custom cap — studio_preferences set_session_budget <usd> or say "budget $10"`,
    `(C) Disable (unlimited) — studio_setup({ action: "onboard", disable_budget: true }) or set_session_budget 0 / say "disable budget"`,
  ].join(" ")
}
