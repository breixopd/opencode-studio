import { describe, it, expect } from "bun:test"
import {
  planFanOut,
  fanOutInstruction,
  startWorkFanOutStep,
} from "./fan-out"

describe("fan-out", () => {
  it("does not fan out for trivial work (≤3 steps, no sensitive keywords)", () => {
    const plan = planFanOut("Add a greeting function", 2)
    expect(plan.parallel).toBe(false)
    expect(plan.agents.length).toBe(1)
    expect(plan.agents[0]!.name).toBe("@studio-explore")
  })

  it("fans out for auth-related work", () => {
    const plan = planFanOut("Add JWT authentication to the API", 4)
    expect(plan.parallel).toBe(true)
    expect(plan.agents.length).toBeGreaterThanOrEqual(2)
    expect(plan.agents.some((a) => a.name === "@studio-security")).toBe(true)
  })

  it("fans out for complex work (>3 steps)", () => {
    const plan = planFanOut("Refactor the module system", 5)
    expect(plan.parallel).toBe(true)
    expect(plan.agents.length).toBeGreaterThanOrEqual(2)
    expect(plan.agents.some((a) => a.name === "@studio-architect")).toBe(true)
  })

  it("fans out for database migration work", () => {
    const plan = planFanOut("Add database migration for user table", 3)
    expect(plan.parallel).toBe(true)
    expect(plan.agents.some((a) => a.name === "@studio-architect")).toBe(true)
  })

  it("fanOutInstruction generates concurrent dispatch text for parallel plans", () => {
    const instruction = fanOutInstruction("Add JWT authentication to the API", 4)
    expect(instruction).toContain("Concurrent fan-out")
    expect(instruction).toContain("@studio-explore")
    expect(instruction).toContain("@studio-security")
    expect(instruction).toContain("IN ONE MESSAGE")
  })

  it("fanOutInstruction generates simple instruction for trivial work", () => {
    const instruction = fanOutInstruction("Add a greeting function", 2)
    expect(instruction).toContain("@studio-explore")
    expect(instruction).not.toContain("Concurrent fan-out")
  })

  it("startWorkFanOutStep is static and does not hardcode planSteps=4", () => {
    const step = startWorkFanOutStep()
    expect(step).toContain("REAL size")
    expect(step).toContain("@studio-explore")
    expect(step).toContain("IN ONE MESSAGE")
    expect(step).not.toMatch(/planSteps|,\s*4\)/)
    // Must not bake a specific fan-out for a fake 4-step plan
    expect(step).not.toContain("Concurrent fan-out (")
  })
})
