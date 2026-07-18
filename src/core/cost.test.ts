import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { clearActiveDirectory, setActiveDirectory } from "./active-dir"
import { closeStudioDb } from "./studio-db"
import { recordCostEvent, getCostSummary, formatCostSummary, pruneOldCostEvents } from "./cost"

describe("cost ledger", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-cost-"))
    setActiveDirectory(dir)
  })

  afterEach(() => {
    closeStudioDb(dir)
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
  })

  it("records a cost event and summarizes it", () => {
    recordCostEvent({
      id: "msg1",
      sessionID: "sess1",
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      cost: 0.0042,
      tokens: {
        input: 1000,
        output: 500,
        reasoning: 0,
        cache: { read: 200, write: 100 },
      },
      time: { created: Date.now() },
    })

    const summary = getCostSummary()
    expect(summary.messageCount).toBe(1)
    expect(summary.totalCost).toBe(0.0042)
    expect(summary.totalTokens.input).toBe(1000)
    expect(summary.totalTokens.output).toBe(500)
    expect(summary.totalTokens.cacheRead).toBe(200)
    expect(summary.byModel).toHaveLength(1)
    expect(summary.byModel[0].modelId).toBe("claude-sonnet-4-6")
  })

  it("upserts on message_id (keeps latest cost)", () => {
    const base = {
      id: "msg-dup",
      sessionID: "sess1",
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    }
    recordCostEvent({ ...base, cost: 0.01 })
    recordCostEvent({
      ...base,
      cost: 0.05,
      tokens: { input: 200, output: 80, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const summary = getCostSummary()
    expect(summary.messageCount).toBe(1)
    expect(summary.totalCost).toBe(0.05)
    expect(summary.totalTokens.input).toBe(200)
  })

  it("filters by session", () => {
    recordCostEvent({
      id: "msg-a",
      sessionID: "sess-A",
      providerID: "anthropic",
      modelID: "claude-haiku",
      cost: 0.001,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    })
    recordCostEvent({
      id: "msg-b",
      sessionID: "sess-B",
      providerID: "openai",
      modelID: "gpt-4o",
      cost: 0.005,
      tokens: { input: 500, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    })

    const aSummary = getCostSummary({ sessionId: "sess-A" })
    expect(aSummary.messageCount).toBe(1)
    expect(aSummary.byModel[0].providerId).toBe("anthropic")

    const all = getCostSummary()
    expect(all.messageCount).toBe(2)
    expect(all.totalCost).toBe(0.006)
  })

  it("formats summary as readable markdown", () => {
    recordCostEvent({
      id: "msg-fmt",
      sessionID: "sess1",
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      cost: 0.0042,
      tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 200, write: 100 } },
      time: { created: Date.now() },
    })

    const out = formatCostSummary(getCostSummary())
    expect(out).toContain("$0.0042")
    expect(out).toContain("1 message")
    expect(out).toContain("claude-sonnet-4-6")
  })

  it("prunes old events", () => {
    recordCostEvent({
      id: "msg-old",
      sessionID: "sess1",
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      cost: 0.001,
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() - 31 * 24 * 3600_000 }, // 31 days ago
    })
    const deleted = pruneOldCostEvents(30)
    expect(deleted).toBe(1)
    expect(getCostSummary().messageCount).toBe(0)
  })
})
