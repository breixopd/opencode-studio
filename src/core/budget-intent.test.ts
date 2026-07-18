import { describe, it, expect } from "bun:test"
import { detectBudgetIntent } from "./budget-intent"

describe("detectBudgetIntent", () => {
  it("detects set phrases", () => {
    expect(detectBudgetIntent("budget $5")).toEqual({ kind: "set", usd: 5 })
    expect(detectBudgetIntent("set session budget to 10")).toEqual({ kind: "set", usd: 10 })
    expect(detectBudgetIntent("spend cap 2.50")).toEqual({ kind: "set", usd: 2.5 })
  })

  it("detects disable / clear phrases", () => {
    expect(detectBudgetIntent("disable budget")).toEqual({ kind: "clear" })
    expect(detectBudgetIntent("clear session budget")).toEqual({ kind: "clear" })
    expect(detectBudgetIntent("unlimited budget please")).toEqual({ kind: "clear" })
    expect(detectBudgetIntent("budget off")).toEqual({ kind: "clear" })
    expect(detectBudgetIntent("no spend cap")).toEqual({ kind: "clear" })
    expect(detectBudgetIntent("budget 0")).toEqual({ kind: "clear" })
  })

  it("returns null for unrelated text", () => {
    expect(detectBudgetIntent("fix the login bug")).toBeNull()
  })
})
