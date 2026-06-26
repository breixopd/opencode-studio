import { describe, it, expect, beforeEach } from "bun:test"
import {
  OutputDeduplicator,
  compactToolOutput,
  optimizeToolOutput,
  tokenEst,
  truncateToTokenBudget,
} from "./token-budget"

describe("token-budget", () => {
  it("tokenEst approximates chars/4", () => {
    expect(tokenEst("")).toBe(0)
    expect(tokenEst("ab")).toBe(1)
    expect(tokenEst("abcdefgh")).toBe(2)
  })

  it("truncateToTokenBudget preserves short text", () => {
    expect(truncateToTokenBudget("hi", 100)).toBe("hi")
  })

  it("truncateToTokenBudget caps long text", () => {
    const long = "x".repeat(1000)
    const out = truncateToTokenBudget(long, 10)
    expect(out.length).toBeLessThan(long.length)
    expect(out).toContain("truncated")
  })

  it("compactToolOutput collapses blank lines and trailing whitespace", () => {
    const input = "a   \n\n\n\nb\n   \n"
    expect(compactToolOutput(input)).toBe("a\n\nb")
  })

  describe("OutputDeduplicator", () => {
    let d: OutputDeduplicator
    beforeEach(() => {
      d = new OutputDeduplicator()
    })

    it("returns false on first sight, true on repeat", () => {
      expect(d.isDuplicate("foo")).toBe(false)
      expect(d.isDuplicate("foo")).toBe(true)
    })

    it("filter returns empty string for duplicates", () => {
      d.filter("foo")
      expect(d.filter("foo")).toBe("")
    })

    it("reset clears memory", () => {
      d.filter("foo")
      d.reset()
      expect(d.isDuplicate("foo")).toBe(false)
    })
  })

  it("optimizeToolOutput chains dedupe + compact + truncate", () => {
    const d = new OutputDeduplicator()
    const text = "a   \n\n\n\nb"
    expect(optimizeToolOutput(text, d, { budget: 100, compact: true })).toBe("a\n\nb")
    // Second call is duplicate
    expect(optimizeToolOutput(text, d)).toContain("skipped")
  })
})
