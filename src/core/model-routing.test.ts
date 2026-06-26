import { describe, it, expect, beforeEach } from "bun:test"
import { applyStudioModelRouting, parseModelRef, isTrivialPlan, resetRoutingState } from "./model-routing"
import { setModelMode } from "./project-profile"
import { resetZenCatalogCache } from "./model-catalog"
import type { Config } from "@opencode-ai/plugin"

const TEST_ZEN = ["deepseek-v4-flash-free", "north-mini-code-free", "nemotron-3-ultra-free"]

describe("applyStudioModelRouting", () => {
  beforeEach(() => {
    resetRoutingState()
    resetZenCatalogCache()
    setModelMode("balanced")
  })
  it("assigns free zen models to read-only agents in balanced mode", () => {
    const config: Config = {
      agent: {
        "studio-explore": { mode: "subagent" },
        "studio-implement": { mode: "subagent" },
      },
    }
    applyStudioModelRouting(config, TEST_ZEN)
    expect(config.agent!["studio-explore"]!.model).toBe("opencode/deepseek-v4-flash-free")
    expect(config.agent!["studio-implement"]!.model).toBe("opencode/north-mini-code-free")
  })

  it("inherits main model for implement when set (balanced)", () => {
    const config: Config = {
      model: "anthropic/claude-sonnet-4-6",
      agent: {
        "studio-implement": { mode: "subagent" },
        "studio-architect": { mode: "subagent" },
      },
    }
    applyStudioModelRouting(config, TEST_ZEN)
    expect(config.agent!["studio-implement"]!.model).toBe("anthropic/claude-sonnet-4-6")
    expect(config.agent!["studio-architect"]!.model).toBe("anthropic/claude-sonnet-4-6")
  })

  it("routes read-only to zen free even when main is anthropic", () => {
    const config: Config = {
      model: "anthropic/claude-opus-4-6",
      agent: { "studio-explore": { mode: "subagent" } },
    }
    applyStudioModelRouting(config, TEST_ZEN)
    expect(config.agent!["studio-explore"]!.model).toBe("opencode/deepseek-v4-flash-free")
  })

  it("uses anthropic tiers when zen disabled and no main on write agents", () => {
    const config: Config = {
      disabled_providers: ["opencode"],
      model: "anthropic/claude-sonnet-4-6",
      agent: { "studio-explore": { mode: "subagent" } },
    }
    applyStudioModelRouting(config, TEST_ZEN)
    expect(config.agent!["studio-explore"]!.model).toBe("anthropic/claude-haiku-4-5")
  })

  it("does not override user agent model", () => {
    const config: Config = {
      agent: {
        "studio-explore": { mode: "subagent", model: "anthropic/claude-opus-4" },
      },
    }
    applyStudioModelRouting(config, TEST_ZEN)
    expect(config.agent!["studio-explore"]!.model).toBe("anthropic/claude-opus-4")
  })
})

describe("parseModelRef", () => {
  it("parses provider/model", () => {
    expect(parseModelRef("anthropic/claude-sonnet-4-6")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    })
  })
})

describe("isTrivialPlan", () => {
  it("detects trivial plans", () => {
    expect(isTrivialPlan(null)).toBe(true)
    expect(
      isTrivialPlan({
        id: "1",
        title: "t",
        goal: "fix typo",
        research: [],
        architecture: "",
        fileStructure: "",
        steps: [{ text: "a", done: false }],
        acceptance: [],
        edgeCases: "",
        testStrategy: "",
        revisions: [],
        createdAt: "",
        updatedAt: "",
      }),
    ).toBe(true)
  })
})
