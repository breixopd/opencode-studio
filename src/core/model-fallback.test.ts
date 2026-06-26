import { describe, it, expect, beforeEach } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import {
  isRateLimitError,
  markModelExhausted,
  clearExhaustedModels,
  buildFallbackChain,
  pickFallbackModel,
} from "./model-fallback"

describe("model-fallback", () => {
  beforeEach(() => clearExhaustedModels())

  it("detects rate limit errors", () => {
    expect(isRateLimitError({ data: { statusCode: 429, message: "rate limit" } })).toBe(true)
    expect(isRateLimitError({ data: { message: "quota exceeded" } })).toBe(true)
    expect(isRateLimitError({ data: { message: "ok" } })).toBe(false)
  })

  it("falls back from exhausted free zen to paid then main provider", () => {
    const config: Config = {
      model: "anthropic/claude-sonnet-4-6",
      agent: { "studio-explore": { mode: "subagent" } },
    }
    const catalog = ["deepseek-v4-flash-free", "north-mini-code-free", "deepseek-v4-flash"]

    markModelExhausted("opencode/deepseek-v4-flash-free")
    const chain = buildFallbackChain(config, "fast", catalog)
    expect(chain[0]).not.toBe("opencode/deepseek-v4-flash-free")
    expect(chain.some((m) => m.includes("deepseek-v4-flash"))).toBe(true)

    const next = pickFallbackModel(config, "fast", "opencode/deepseek-v4-flash-free", catalog)
    expect(next).toBeDefined()
    expect(next).not.toBe("opencode/deepseek-v4-flash-free")
  })
})
