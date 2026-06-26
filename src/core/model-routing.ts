import type { Config } from "@opencode-ai/plugin"
import { loadUserProfile, type ModelMode } from "./project-profile"
import {
  type ModelTier,
  PROVIDER_TIERS,
  pickZenModelForTier,
  fetchZenModelIds,
  isFreeZenModel,
} from "./model-catalog"
import { getActivePlan } from "./workspace"
import { formatModelRef, parseModelRef, ZEN_PROVIDER } from "./model-registry"
import { isModelExhausted, clearExhaustedModels } from "./model-fallback"
import { pickTierModelFromRegistry } from "./model-registry"
import {
  CODE_AGENTS,
  READ_ONLY_AGENTS,
  REASON_AGENTS,
  STUDIO_AGENT_NAMES,
  tierForAgent,
} from "./agent-tiers"

export { ZEN_PROVIDER, parseModelRef, formatModelRef } from "./model-registry"
export { STUDIO_AGENT_NAMES } from "./agent-tiers"

function providerEnabled(config: Config, provider: string): boolean {
  if (config.disabled_providers?.includes(provider)) return false
  if (config.enabled_providers?.length) return config.enabled_providers.includes(provider)
  return true
}

function zenEnabled(config: Config): boolean {
  return providerEnabled(config, ZEN_PROVIDER)
}

function listProviders(config: Config): string[] {
  const found = new Set<string>()
  if (config.model) found.add(parseModelRef(config.model).provider)
  if (config.provider) {
    for (const id of Object.keys(config.provider)) found.add(id)
  }
  if (config.enabled_providers) {
    for (const id of config.enabled_providers) found.add(id)
  }
  if (!found.size) found.add(ZEN_PROVIDER)
  return [...found].filter((p) => providerEnabled(config, p))
}

function modelListed(config: Config, provider: string, modelId: string): boolean {
  const models = config.provider?.[provider]?.models
  if (!models || !Object.keys(models).length) return true
  return modelId in models
}

function pickFromProvider(
  config: Config,
  provider: string,
  tier: ModelTier,
  zenCatalog: string[],
): string | undefined {
  const table = PROVIDER_TIERS[provider]
  const candidates: string[] = []

  if (provider === ZEN_PROVIDER) {
    const dynamic = pickZenModelForTier(tier, zenCatalog)
    if (dynamic) candidates.push(dynamic)
  }

  if (table?.[tier]) candidates.push(table[tier])

  const fromRegistry = pickTierModelFromRegistry(provider, tier)
  if (fromRegistry && !candidates.includes(fromRegistry) && modelListed(config, provider, fromRegistry)) {
    candidates.unshift(fromRegistry)
  }

  for (const modelId of candidates) {
    const ref = formatModelRef(provider, modelId)
    if (isModelExhausted(ref)) continue
    if (modelListed(config, provider, modelId)) return ref
  }
  return undefined
}

function pickTierModel(
  config: Config,
  tier: ModelTier,
  zenCatalog: string[],
  preferProvider?: string,
): string | undefined {
  const order = preferProvider
    ? [preferProvider, ...listProviders(config).filter((p) => p !== preferProvider)]
    : listProviders(config)

  for (const provider of order) {
    const picked = pickFromProvider(config, provider, tier, zenCatalog)
    if (picked) return picked
  }
  return undefined
}

export function isTrivialPlan(plan: ReturnType<typeof getActivePlan>): boolean {
  if (!plan) return true
  const blob = [plan.goal, plan.architecture, plan.edgeCases, plan.testStrategy].join(" ")
  const securitySensitive = /auth|secret|password|payment|api.?key|sql|inject|crypto|token/i.test(blob)
  return plan.steps.length <= 2 && plan.architecture.trim().length < 200 && !securitySensitive
}

function agentTier(agentName: string): ModelTier {
  const plan = getActivePlan()
  if (REASON_AGENTS.has(agentName) && isTrivialPlan(plan)) return "fast"
  return tierForAgent(agentName)
}

function routeAgentModel(
  config: Config,
  agentName: string,
  mode: ModelMode,
  zenCatalog: string[],
): string | undefined {
  const main = getLastMainModel() ?? config.model
  const mainProvider = main ? parseModelRef(main).provider : undefined
  const tier = agentTier(agentName)

  if (mode === "quality") {
    return main ?? pickTierModel(config, "reason", zenCatalog, mainProvider)
  }

  if (mode === "free") {
    if (zenEnabled(config)) {
      const zenPick = pickFromProvider(config, ZEN_PROVIDER, tier, zenCatalog)
      if (zenPick) return zenPick
    }
    return pickTierModel(config, tier, zenCatalog, mainProvider)
  }

  // balanced (default) — Cursor/Claude Code style: cheap for read, main for write
  if (READ_ONLY_AGENTS.has(agentName)) {
    if (zenEnabled(config)) {
      const free = pickFromProvider(config, ZEN_PROVIDER, "fast", zenCatalog)
      if (free) return free
    }
    return pickTierModel(config, "fast", zenCatalog, mainProvider)
  }

  if (main && (CODE_AGENTS.has(agentName) || REASON_AGENTS.has(agentName))) {
    return main
  }

  return pickTierModel(config, tier, zenCatalog, mainProvider)
}

/**
 * Autonomous model routing across providers.
 *
 * **Other providers (Anthropic, OpenAI, Google):** uses tier tables on the user's
 * primary provider from `config.model`. Read-only subagents get fast/cheap models on
 * that same provider; implement/review inherit your main model.
 *
 * **Zen connected:** read-only agents prefer free Zen models even when main model
 * is Anthropic — saves credits without config edits.
 *
 * **model_mode** (`studio_preferences set_model_mode`): free | balanced | quality
 */
const studioRoutedAgents = new Set<string>()

let latestConfig: Config | null = null

export function applyStudioModelRouting(config: Config, zenCatalog: string[] = []): void {
  const mode = loadUserProfile().modelMode ?? "balanced"
  const effectiveMain = getLastMainModel() ?? config.model

  if (!config.small_model) {
    if (zenEnabled(config)) {
      const small = pickFromProvider(config, ZEN_PROVIDER, "fast", zenCatalog)
      if (small) config.small_model = small
    } else if (effectiveMain) {
      const { provider } = parseModelRef(effectiveMain)
      const small = pickFromProvider(config, provider, "fast", zenCatalog)
      if (small) config.small_model = small
    }
  }

  config.agent ??= {}
  for (const name of STUDIO_AGENT_NAMES) {
    const agent = config.agent[name]
    if (!agent) continue
    if (agent.model && !studioRoutedAgents.has(name)) continue
    const picked = routeAgentModel(config, name, mode, zenCatalog)
    if (picked) {
      agent.model = picked
      studioRoutedAgents.add(name)
    }
  }
}

export function getLastRoutedModels(): Record<string, string> {
  const out: Record<string, string> = {}
  if (!latestConfig?.agent) return out
  for (const name of STUDIO_AGENT_NAMES) {
    out[name] = latestConfig.agent[name]?.model ?? ""
  }
  return out
}

export function clearStudioRoutedAgents(): void {
  studioRoutedAgents.clear()
}

export function resetRoutingState(): void {
  studioRoutedAgents.clear()
  latestConfig = null
  clearExhaustedModels()
}

export function getLatestConfig(): Config | null {
  return latestConfig
}

export function setLatestConfig(config: Config): void {
  latestConfig = config
}

export async function refreshModelRouting(): Promise<void> {
  if (!latestConfig) return
  const catalog = await fetchZenModelIds()
  applyStudioModelRouting(latestConfig, catalog)
}

/** Prefetch Zen catalog — fire-and-forget from event hook. */
export function prefetchZenCatalog(): void {
  fetchZenModelIds().catch(() => {})
}

export function describeRoutingForProvider(config: Config): string {
  const mode = loadUserProfile().modelMode ?? "balanced"
  const main = getLastMainModel() ?? config.model ?? "(unset)"
  const providers = listProviders(config)
  const zen = zenEnabled(config)
  return [
    `Model mode: ${mode}`,
    `Main model: ${main}`,
    `Providers: ${providers.join(", ")}`,
    `Zen: ${zen ? "enabled — read-only agents prefer free tier" : "disabled — tiers use your provider tables"}`,
    "Per-agent overrides in opencode.json always win.",
    "On rate limits: tries other free Zen → paid Zen → your provider tier → main model.",
  ].join("\n")
}

export function isLikelyFreeModel(modelRef: string): boolean {
  const { provider, modelId } = parseModelRef(modelRef)
  return provider === ZEN_PROVIDER && isFreeZenModel(modelId)
}
/** Tracks the model the user picked in the OpenCode UI (per session + last known). */

const bySession = new Map<string, string>()
let lastMainModel: string | undefined

export function setSessionMainModel(sessionID: string, providerID: string, modelID: string): void {
  const ref = `${providerID}/${modelID}`
  bySession.set(sessionID, ref)
  lastMainModel = ref
}

export function getSessionMainModel(sessionID?: string): string | undefined {
  if (sessionID && bySession.has(sessionID)) return bySession.get(sessionID)
  return lastMainModel
}

export function getLastMainModel(): string | undefined {
  return lastMainModel
}

export function resetSessionModels(): void {
  bySession.clear()
  lastMainModel = undefined
}
