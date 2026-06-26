import type { Config } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import {
  fetchZenModelIds,
  resetZenCatalogCache,
  type ModelTier,
} from "./model-catalog"
import { parseModelRef } from "./model-refs"

const REGISTRY_PATH = join(homedir(), ".config", "opencode-studio", "models.json")

const TIER_PATTERNS: Record<ModelTier, RegExp> = {
  fast: /flash|haiku|nano|mini|pickle|mimo|lite/i,
  code: /code|coder|north-mini|codex/i,
  reason: /opus|pro|ultra|nemotron|sonnet|glm-5|gpt-5/i,
}

export interface ModelMeta {
  id: string
  provider: string
  tier?: ModelTier
  free?: boolean
  notes?: string
}

export interface ModelRegistry {
  providersFingerprint: string
  pendingProviderRefresh: boolean
  zen: { ids: string[]; fetchedAt: string }
  providers: Record<string, { models: Record<string, ModelMeta> }>
  updatedAt: string
}

function now(): string {
  return new Date().toISOString()
}

function ensureDir(): void {
  mkdirSync(join(homedir(), ".config", "opencode-studio"), { recursive: true })
}

export function loadModelRegistry(): ModelRegistry {
  if (!existsSync(REGISTRY_PATH)) {
    return {
      providersFingerprint: "",
      pendingProviderRefresh: false,
      zen: { ids: [], fetchedAt: "" },
      providers: {},
      updatedAt: now(),
    }
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as ModelRegistry
}

export function saveModelRegistry(registry: ModelRegistry): void {
  ensureDir()
  registry.updatedAt = now()
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8")
}

export function fingerprintProviders(config: Config): string {
  const enabled = listEnabledProviders(config).sort()
  return enabled.join(",")
}

export function listEnabledProviders(config: Config): string[] {
  const found = new Set<string>()
  if (config.model) found.add(parseModelRef(config.model).provider)
  if (config.provider) {
    for (const id of Object.keys(config.provider)) {
      if (config.disabled_providers?.includes(id)) continue
      found.add(id)
    }
  }
  if (config.enabled_providers?.length) {
    for (const id of config.enabled_providers) {
      if (!config.disabled_providers?.includes(id)) found.add(id)
    }
  }
  return [...found]
}

function inferTier(modelId: string): ModelTier | undefined {
  for (const [tier, re] of Object.entries(TIER_PATTERNS) as Array<[ModelTier, RegExp]>) {
    if (re.test(modelId)) return tier
  }
  return undefined
}

function inferMeta(provider: string, modelId: string): ModelMeta {
  const tier = inferTier(modelId)
  const free = /-free$|^big-pickle$/i.test(modelId)
  const notes: string[] = []
  if (tier) notes.push(`inferred tier: ${tier}`)
  if (free) notes.push("likely free tier")
  return {
    id: modelId,
    provider,
    tier,
    free,
    notes: notes.join("; ") || undefined,
  }
}

/** Sync provider models from OpenCode config into local registry (heuristic metadata). */
export function syncProviderModelsFromConfig(config: Config): {
  added: string[]
  removed: string[]
  registry: ModelRegistry
} {
  const registry = loadModelRegistry()
  const fp = fingerprintProviders(config)
  const prevFp = registry.providersFingerprint
  const added: string[] = []
  const removed: string[] = []

  if (prevFp && prevFp !== fp) {
    const prev = new Set(prevFp.split(",").filter(Boolean))
    const next = new Set(fp.split(",").filter(Boolean))
    for (const p of next) if (!prev.has(p)) added.push(p)
    for (const p of prev) if (!next.has(p)) removed.push(p)
    registry.pendingProviderRefresh = true
  }

  registry.providersFingerprint = fp

  for (const provider of listEnabledProviders(config)) {
    registry.providers[provider] ??= { models: {} }
    const models = config.provider?.[provider]?.models ?? {}
    const ids = Object.keys(models)
    if (!ids.length && config.model && parseModelRef(config.model).provider === provider) {
      ids.push(parseModelRef(config.model).modelId)
    }
    for (const id of ids) {
      registry.providers[provider].models[id] = inferMeta(provider, id)
    }
  }

  saveModelRegistry(registry)
  return { added, removed, registry }
}

export async function refreshZenInRegistry(): Promise<ModelRegistry> {
  resetZenCatalogCache()
  const ids = await fetchZenModelIds()
  const registry = loadModelRegistry()
  registry.zen = { ids, fetchedAt: now() }
  registry.providers.opencode ??= { models: {} }
  for (const id of ids) {
    registry.providers.opencode.models[id] = inferMeta("opencode", id)
  }
  registry.pendingProviderRefresh = false
  saveModelRegistry(registry)
  return registry
}

export function pickTierModelFromRegistry(
  provider: string,
  tier: ModelTier,
): string | undefined {
  const registry = loadModelRegistry()
  const models = registry.providers[provider]?.models ?? {}
  const preferred = Object.values(models).find((m) => m.tier === tier)
  return preferred?.id
}

export function describeProviderChange(config: Config): string | null {
  const registry = loadModelRegistry()
  const fp = fingerprintProviders(config)
  if (!registry.providersFingerprint) return null
  if (fp === registry.providersFingerprint) {
    if (registry.pendingProviderRefresh) {
      return "Provider catalog may be stale — run studio_models sync_providers or refresh_all."
    }
    return null
  }
  const prev = new Set(registry.providersFingerprint.split(",").filter(Boolean))
  const next = new Set(fp.split(",").filter(Boolean))
  const added = [...next].filter((p) => !prev.has(p))
  const removed = [...prev].filter((p) => !next.has(p))
  const parts: string[] = []
  if (added.length) parts.push(`added: ${added.join(", ")}`)
  if (removed.length) parts.push(`removed: ${removed.join(", ")}`)
  return `Providers changed (${parts.join("; ")}). Run studio_models refresh_all to update routing catalog.`
}

export function clearPendingProviderRefresh(): void {
  const registry = loadModelRegistry()
  registry.pendingProviderRefresh = false
  saveModelRegistry(registry)
}

export function registrySummary(): string {
  const r = loadModelRegistry()
  const lines = [
    `Providers: ${r.providersFingerprint || "(none synced)"}`,
    `Zen models: ${r.zen.ids.length} (fetched ${r.zen.fetchedAt || "never"})`,
    `Pending refresh: ${r.pendingProviderRefresh ? "yes" : "no"}`,
  ]
  for (const [provider, data] of Object.entries(r.providers)) {
    lines.push(`  ${provider}: ${Object.keys(data.models).length} models`)
  }
  return lines.join("\n")
}
