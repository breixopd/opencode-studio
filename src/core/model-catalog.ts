import * as log from "./logger"
/** Dynamic Zen model catalog + provider tier tables. */

export const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models"

const FREE_MODEL_PATTERNS = /-free$|^big-pickle$/i

const TIER_KEYWORDS: Record<"fast" | "code" | "reason", RegExp> = {
  fast: /flash|haiku|nano|mini|pickle|mimo/i,
  code: /code|coder|north-mini/i,
  reason: /opus|pro|ultra|nemotron|sonnet|glm-5/i,
}

export type ModelTier = "fast" | "code" | "reason"

let zenCatalogCache: { ids: string[]; fetchedAt: number } | null = null
const CACHE_MS = 60 * 60 * 1000

export async function fetchZenModelIds(): Promise<string[]> {
  if (zenCatalogCache && Date.now() - zenCatalogCache.fetchedAt < CACHE_MS) {
    return zenCatalogCache.ids
  }
  try {
    const res = await fetch(ZEN_MODELS_URL, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return zenCatalogCache?.ids ?? []
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    const ids = (data.data ?? []).map((m) => m.id)
    zenCatalogCache = { ids, fetchedAt: Date.now() }
    return ids
  } catch (err) {
      log.debugCatch("src/core/model-catalog.ts", err);
    /* network/registry unreachable — fall back to cached ids */
    return zenCatalogCache?.ids ?? []
  }
}

export function isFreeZenModel(modelId: string): boolean {
  return FREE_MODEL_PATTERNS.test(modelId)
}

export function pickZenModelForTier(tier: ModelTier, catalog?: string[]): string | undefined {
  const ids = catalog ?? zenCatalogCache?.ids ?? []
  const free = ids.filter(isFreeZenModel)
  if (!free.length) return undefined

  const keywordMatch = free.find((id) => TIER_KEYWORDS[tier].test(id))
  if (keywordMatch) return keywordMatch

  const defaults: Record<ModelTier, string> = {
    fast: "deepseek-v4-flash-free",
    code: "north-mini-code-free",
    reason: "nemotron-3-ultra-free",
  }
  if (free.includes(defaults[tier])) return defaults[tier]
  return free[0]
}

/**
 * Known cheap/strong models per provider when catalog isn't available.
 *
 * Local providers (ollama / lmstudio / local): prefer small tool-calling models
 * that fit modest hardware (≈4–8GB). Qwen3.5 4B / Qwen3 8B lead 2026 tool-call
 * evals; Nemotron Nano 4B is a strong alternative. Cactus Compute Needle (26M)
 * is ideal for tiny tool-routing sidekicks via an OpenAI-compatible endpoint.
 */
export const PROVIDER_TIERS: Record<string, Record<ModelTier, string>> = {
  opencode: {
    fast: "deepseek-v4-flash-free",
    code: "north-mini-code-free",
    reason: "nemotron-3-ultra-free",
  },
  anthropic: {
    fast: "claude-haiku-4-5",
    code: "claude-sonnet-4-6",
    reason: "claude-opus-4-6",
  },
  openai: {
    fast: "gpt-5.4-nano",
    code: "gpt-5.4-mini",
    reason: "gpt-5.4",
  },
  google: {
    fast: "gemini-3-flash",
    code: "gemini-3.5-flash",
    reason: "gemini-3.1-pro",
  },
  // Local / self-hosted — OpenAI-compatible endpoints
  ollama: {
    fast: "qwen3.5:4b",
    code: "qwen3:8b",
    reason: "qwen3:14b",
  },
  lmstudio: {
    fast: "qwen3.5-4b",
    code: "qwen3-8b",
    reason: "qwen3-14b",
  },
  local: {
    fast: "qwen3.5:4b",
    code: "qwen3:8b",
    reason: "qwen3:14b",
  },
}

/** Providers treated as local/zero-cost for prefer_local routing. */
export const LOCAL_PROVIDERS = ["ollama", "lmstudio", "local"] as const

export function resetZenCatalogCache(): void {
  zenCatalogCache = null
}
