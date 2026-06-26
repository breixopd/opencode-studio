import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { Config } from "@opencode-ai/plugin"
import { getLatestConfig } from "../core/model-routing"
import {
  clearPendingProviderRefresh,
  refreshZenInRegistry,
  registrySummary,
  syncProviderModelsFromConfig,
} from "../core/model-registry"
import { clearStudioRoutedAgents, refreshModelRouting } from "../core/model-routing"

export const studio_models: ToolDefinition = tool({
  description:
    "Model catalog: sync enabled providers from OpenCode config, refresh Zen list, infer tiers. Run after adding/removing providers.",
  args: {
    action: tool.schema
      .enum(["show", "sync_providers", "refresh_zen", "refresh_all", "dismiss_notice"])
      .describe("show | sync from config | refresh zen API | both + reroute | clear provider-change notice"),
  },
  async execute(args) {
    const config = (getLatestConfig() ?? {}) as Config

    if (args.action === "show") {
      const change = syncProviderModelsFromConfig(config)
      const lines = [registrySummary()]
      if (change.added.length || change.removed.length) {
        lines.push(`Detected change: +[${change.added.join(", ")}] -[${change.removed.join(", ")}]`)
        lines.push("Run refresh_all to update routing.")
      }
      return lines.join("\n")
    }

    if (args.action === "sync_providers") {
      const { added, removed, registry } = syncProviderModelsFromConfig(config)
      clearStudioRoutedAgents()
      await refreshModelRouting()
      const msg = [
        `Synced ${Object.keys(registry.providers).length} providers.`,
        added.length ? `Added: ${added.join(", ")}` : "",
        removed.length ? `Removed: ${removed.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
      return msg || "Provider catalog synced."
    }

    if (args.action === "refresh_zen") {
      const registry = await refreshZenInRegistry()
      clearStudioRoutedAgents()
      await refreshModelRouting()
      return `Zen catalog refreshed: ${registry.zen.ids.length} models. Routing updated.`
    }

    if (args.action === "refresh_all") {
      syncProviderModelsFromConfig(config)
      const registry = await refreshZenInRegistry()
      clearPendingProviderRefresh()
      clearStudioRoutedAgents()
      await refreshModelRouting()
      return `Full catalog refresh: ${registry.zen.ids.length} zen models, ${Object.keys(registry.providers).length} providers. Routing updated.`
    }

    if (args.action === "dismiss_notice") {
      clearPendingProviderRefresh()
      return "Provider change notice dismissed."
    }

    return "Unknown action"
  },
})
