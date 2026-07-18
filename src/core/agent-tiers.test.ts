import { describe, it, expect } from "bun:test"
import { AGENT_DEFS } from "./agent-defs"
import {
  AGENT_TIER,
  CODE_AGENTS,
  READ_ONLY_AGENTS,
  REASON_AGENTS,
  STUDIO_AGENT_NAMES,
} from "./agent-tiers"

describe("agent-tiers", () => {
  it("STUDIO_AGENT_NAMES matches every AGENT_DEFS name", () => {
    const fromDefs = AGENT_DEFS.map((d) => d.name).sort()
    expect([...STUDIO_AGENT_NAMES].sort()).toEqual(fromDefs)
  })

  it("tier sets cover all AGENT_DEFS names exactly once", () => {
    const covered = new Set([...READ_ONLY_AGENTS, ...REASON_AGENTS, ...CODE_AGENTS])
    for (const def of AGENT_DEFS) {
      expect(covered.has(def.name)).toBe(true)
      expect(AGENT_TIER[def.name]).toBeDefined()

      const inRead = READ_ONLY_AGENTS.has(def.name) ? 1 : 0
      const inReason = REASON_AGENTS.has(def.name) ? 1 : 0
      const inCode = CODE_AGENTS.has(def.name) ? 1 : 0
      expect(inRead + inReason + inCode).toBe(1)
    }
    expect(covered.size).toBe(AGENT_DEFS.length)
  })
})
