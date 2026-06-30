import type { Event } from "@opencode-ai/sdk"
import { applyFallbackForAgent, isRateLimitError } from "../core/model-fallback"
import { getLatestConfig, refreshModelRouting, STUDIO_AGENT_NAMES } from "../core/model-routing"
import { parseModelRef } from "../core/model-registry"

function isStudioAgent(name: string): boolean {
  return (STUDIO_AGENT_NAMES as readonly string[]).includes(name)
}

async function onAssistantError(
  agentName: string,
  providerID: string,
  modelID: string,
  error: unknown,
): Promise<void> {
  const config = getLatestConfig()
  if (!config || !isStudioAgent(agentName)) return
  const next = await applyFallbackForAgent(config, agentName, providerID, modelID, error)
  if (next) await refreshModelRouting()
}

export function createModelFallbackEventHandler() {
  return async (input: { event: Event }) => {
    const { event } = input

    if (event.type === "message.updated") {
      const info = event.properties?.info
      if (!info || info.role !== "assistant" || !info.error) return
      if (!isRateLimitError(info.error)) return
      await onAssistantError(info.mode, info.providerID, info.modelID, info.error)
      return
    }

    if (event.type === "session.error") {
      const err = event.properties?.error
      if (!err || !isRateLimitError(err)) return
      const config = getLatestConfig()
      if (!config) return
      for (const name of STUDIO_AGENT_NAMES) {
        const model = config.agent?.[name]?.model
        if (!model) continue
        const { provider, modelId } = parseModelRef(model)
        if (isFreeZenFailure(err, modelId)) {
          await onAssistantError(name, provider, modelId, err)
          break
        }
      }
    }
  }
}

function isFreeZenFailure(err: { data?: { message?: string; responseBody?: string } }, modelId: string): boolean {
  const blob = [err.data?.message, err.data?.responseBody].filter(Boolean).join(" ")
  return blob.includes(modelId) || /free|quota|rate/i.test(blob)
}
