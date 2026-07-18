import { describe, it, expect, beforeEach } from "bun:test"
import { setSessionBudgetUsd, getSessionBudgetUsd } from "./project-profile"
import { getBudgetStatus, budgetContextBlock, assertBudgetAllowsTool } from "./budget"

describe("session budget", () => {
  beforeEach(() => {
    setSessionBudgetUsd(null)
  })

  it("stores and clears budget", () => {
    expect(setSessionBudgetUsd(2.5)).toBe(2.5)
    expect(getSessionBudgetUsd()).toBe(2.5)
    expect(setSessionBudgetUsd(0)).toBeNull()
    expect(getSessionBudgetUsd()).toBeNull()
  })

  it("does not block when unlimited", () => {
    expect(() => assertBudgetAllowsTool("studio_search")).not.toThrow()
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
})
