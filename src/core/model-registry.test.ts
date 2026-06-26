import { describe, it, expect } from "bun:test"
import { syncProviderModelsFromConfig, listEnabledProviders, fingerprintProviders } from "./model-registry"

import type { Config } from "@opencode-ai/plugin"

describe("model-registry", () => {
  it("fingerprints enabled providers", () => {
    const config = {
      model: "anthropic/claude-sonnet-4-6",
      provider: {
        anthropic: { models: { "claude-haiku-4-5": {}, "claude-sonnet-4-6": {} } },
        openai: { models: { "gpt-5.4-mini": {} } },
      },
    } as Config
    const fp = fingerprintProviders(config)
    expect(fp).toContain("anthropic")
    expect(fp).toContain("openai")
    const enabled = listEnabledProviders(config)
    expect(enabled).toContain("anthropic")
  })

  it("syncs provider models into registry shape", () => {
    const config = {
      provider: { opencode: { models: { "deepseek-v4-flash-free": {} } } },
    } as Config
    const { registry } = syncProviderModelsFromConfig(config)
    expect(registry.providers.opencode?.models["deepseek-v4-flash-free"]).toBeDefined()
  })
})
