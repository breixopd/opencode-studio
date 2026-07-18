import { describe, it, expect, beforeEach, mock } from "bun:test"

let mockSpent = 0

mock.module("./cost", () => ({
  getCostSummary: () => ({
    totalCost: mockSpent,
    totalTokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    messageCount: 0,
    byModel: [],
    byAgent: [],
  }),
  getLastCostSessionId: () => null,
}))

const {
  setSessionBudgetUsd,
  getSessionBudgetUsd,
  hasExplicitBudget,
  unsetSessionBudgetUsd,
  loadUserProfile,
  saveUserProfile,
} = await import("./project-profile")
const {
  getBudgetStatus,
  budgetContextBlock,
  assertBudgetAllowsTool,
  assertBudgetAllowsSession,
  shouldForceFreeRouting,
  ALLOWED_WHEN_OVER_BUDGET,
} = await import("./budget")

describe("session budget", () => {
  beforeEach(() => {
    mockSpent = 0
    setSessionBudgetUsd(null)
  })

  it("stores and clears budget (clear = unlimited)", () => {
    expect(setSessionBudgetUsd(2.5)).toBe(2.5)
    expect(getSessionBudgetUsd()).toBe(2.5)
    expect(hasExplicitBudget()).toBe(true)
    expect(setSessionBudgetUsd(0)).toBeNull()
    expect(getSessionBudgetUsd()).toBeNull()
    expect(hasExplicitBudget()).toBe(true)
  })

  it("defaults to $5 when never set", () => {
    unsetSessionBudgetUsd()
    expect(hasExplicitBudget()).toBe(false)
    expect(getSessionBudgetUsd()).toBe(5)
    const status = getBudgetStatus()
    expect(status.budgetUsd).toBe(5)
  })

  it("does not block when unlimited", () => {
    expect(() => assertBudgetAllowsTool("studio_search")).not.toThrow()
    expect(() => assertBudgetAllowsTool("studio_plan")).not.toThrow()
    expect(shouldForceFreeRouting()).toBe(false)
  })

  it("reports status shape", () => {
    setSessionBudgetUsd(1)
    const status = getBudgetStatus()
    expect(status.budgetUsd).toBe(1)
    expect(typeof status.spentUsd).toBe("number")
    expect(status.exceeded).toBe(status.spentUsd >= 1)
  })

  it("context block null when under 80%", () => {
    setSessionBudgetUsd(1000)
    expect(budgetContextBlock()).toBeNull()
  })

  it("blocks non-allowlisted tools when exceeded", () => {
    setSessionBudgetUsd(1)
    mockSpent = 1.5
    expect(shouldForceFreeRouting()).toBe(true)
    expect(() => assertBudgetAllowsTool("studio_search")).toThrow(/budget exceeded/i)
    expect(() => assertBudgetAllowsTool("studio_plan")).toThrow(/budget exceeded/i)
    expect(() => assertBudgetAllowsTool("studio_agent")).toThrow(/budget exceeded/i)
    expect(() => assertBudgetAllowsTool("studio_git")).toThrow(/budget exceeded/i)
    expect(() => assertBudgetAllowsSession()).toThrow(/budget exceeded/i)
    for (const tool of ALLOWED_WHEN_OVER_BUDGET) {
      expect(() => assertBudgetAllowsTool(tool)).not.toThrow()
    }
    const block = budgetContextBlock()
    expect(block).toContain("ALL tools blocked")
    expect(block).toContain("preferences/cost/help/doctor")
  })

  it("preserves undefined vs null across save/load", () => {
    unsetSessionBudgetUsd()
    const profile = loadUserProfile()
    expect(profile.sessionBudgetUsd).toBeUndefined()
    saveUserProfile({ ...profile, globalRules: profile.globalRules })
    expect(hasExplicitBudget()).toBe(false)
    expect(getSessionBudgetUsd()).toBe(5)

    setSessionBudgetUsd(null)
    expect(loadUserProfile().sessionBudgetUsd).toBeNull()
    expect(getSessionBudgetUsd()).toBeNull()
  })
})
