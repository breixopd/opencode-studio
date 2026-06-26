export const ZEN_PROVIDER = "opencode"

export function parseModelRef(ref: string): { provider: string; modelId: string } {
  const slash = ref.indexOf("/")
  if (slash === -1) return { provider: ZEN_PROVIDER, modelId: ref }
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) }
}

export function formatModelRef(provider: string, modelId: string): string {
  return `${provider}/${modelId}`
}
