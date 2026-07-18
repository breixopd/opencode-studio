import type { Config } from "@opencode-ai/plugin"
import {
  type ModelTier,
  fetchZenModelIds,
  isFreeZenModel,
  pickZenModelForTier,
  PROVIDER_TIERS,
} from "./model-catalog"
import { formatModelRef, parseModelRef, ZEN_PROVIDER } from "./model-registry"
import { getLastMainModel } from "./model-session"
import * as log from "./logger"
import { tierForAgent } from "./agent-tiers"

type ApiLikeError = {
  name?: string
  data?: {
    message?: string
    statusCode?: number
    responseBody?: string
  }
}

const exhaustedModels = new Set<string>()

const RATE_LIMIT_RE =
  /rate.?limit|quota|too many requests|capacity|exhausted|limit reached|429|insufficient.*credit|billing|overloaded/i

const ZEN_PAID_FALLBACK: Record<ModelTier, string> = {
  fast: "deepseek-v4-flash",
  code: "deepseek-v4-flash",
  reason: "deepseek-v4-pro",
}

export function isModelExhausted(modelRef: string): boolean {
  return exhaustedModels.has(modelRef)
}

export function markModelExhausted(modelRef: string): void {
  exhaustedModels.add(modelRef)
}

export function clearExhaustedModels(): void {
  exhaustedModels.clear()
}

export function listExhaustedModels(): string[] {
  return [...exhaustedModels]
}

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as ApiLikeError
  const status = e.data?.statusCode
  if (status === 429 || status === 402) return true
  const blob = [e.data?.message, e.data?.responseBody, e.name].filter(Boolean).join(" ")
  return RATE_LIMIT_RE.test(blob)
}

function providerEnabled(config: Config, provider: string): boolean {
  if (config.disabled_providers?.includes(provider)) return false
  if (config.enabled_providers?.length) return config.enabled_providers.includes(provider)
  return true
}

function modelListed(config: Config, provider: string, modelId: string): boolean {
  const models = config.provider?.[provider]?.models
  if (!models || !Object.keys(models).length) return true
  return modelId in models
}

function pushCandidate(out: string[], config: Config, provider: string, modelId: string): void {
  if (!providerEnabled(config, provider)) return
  if (!modelListed(config, provider, modelId)) return
  const ref = formatModelRef(provider, modelId)
  if (isModelExhausted(ref)) return
  if (!out.includes(ref)) out.push(ref)
}

function zenFreeCandidates(tier: ModelTier, catalog: string[]): string[] {
  const free = catalog.filter(isFreeZenModel)
  const preferred = pickZenModelForTier(tier, catalog)
  const ordered: string[] = []
  if (preferred) ordered.push(preferred)
  for (const id of free) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  return ordered
}

/** Ordered fallback chain when free / primary model is rate-limited. */
export function buildFallbackChain(
  config: Config,
  tier: ModelTier,
  zenCatalog: string[],
): string[] {
  const chain: string[] = []
  const main = getLastMainModel() ?? config.model
  const mainProvider = main ? parseModelRef(main).provider : undefined

  for (const modelId of zenFreeCandidates(tier, zenCatalog)) {
    pushCandidate(chain, config, ZEN_PROVIDER, modelId)
  }

  pushCandidate(chain, config, ZEN_PROVIDER, ZEN_PAID_FALLBACK[tier])

  if (mainProvider && PROVIDER_TIERS[mainProvider]?.[tier]) {
    pushCandidate(chain, config, mainProvider, PROVIDER_TIERS[mainProvider][tier]!)
  }

  for (const [provider, tiers] of Object.entries(PROVIDER_TIERS)) {
    if (provider === ZEN_PROVIDER || provider === mainProvider) continue
    pushCandidate(chain, config, provider, tiers[tier])
  }

  if (main) pushCandidate(chain, config, parseModelRef(main).provider, parseModelRef(main).modelId)

  return chain
}

export function pickFallbackModel(
  config: Config,
  tier: ModelTier,
  failedRef: string,
  zenCatalog: string[],
): string | undefined {
  markModelExhausted(failedRef)
  const chain = buildFallbackChain(config, tier, zenCatalog)
  return chain.find((ref) => ref !== failedRef)
}

export async function applyFallbackForAgent(
  config: Config,
  agentName: string,
  providerID: string,
  modelID: string,
  error: unknown,
): Promise<string | null> {
  if (!isRateLimitError(error)) return null

  const failedRef = formatModelRef(providerID, modelID)
  const catalog = await fetchZenModelIds()
  const next = pickFallbackModel(config, tierForAgent(agentName), failedRef, catalog)
  if (!next) {
    log.info(`No fallback left after rate limit on ${failedRef}`)
    return null
  }

  config.agent ??= {}
  if (config.agent[agentName]) config.agent[agentName]!.model = next

  log.info(`Rate limit on ${failedRef} → ${next} (${agentName})`)
  return next
}
