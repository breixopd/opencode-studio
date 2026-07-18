import type { ModelTier } from "./model-catalog"

export const STUDIO_AGENT_NAMES = [
  "studio-explore",
  "studio-research",
  "studio-architect",
  "studio-security",
  "studio-implement",
  "studio-review",
  "studio-verify",
  "studio-remote",
  "studio-scout",
] as const

export const READ_ONLY_AGENTS = new Set(["studio-explore", "studio-research", "studio-verify", "studio-scout"])
export const REASON_AGENTS = new Set(["studio-architect", "studio-security", "studio-review"])
export const CODE_AGENTS = new Set(["studio-implement", "studio-remote"])

export const AGENT_TIER: Record<string, ModelTier> = {
  "studio-explore": "fast",
  "studio-research": "fast",
  "studio-verify": "fast",
  "studio-scout": "fast",
  "studio-implement": "code",
  "studio-remote": "code",
  "studio-architect": "reason",
  "studio-security": "reason",
  "studio-review": "reason",
}

export function tierForAgent(agentName: string): ModelTier {
  return AGENT_TIER[agentName] ?? "fast"
}
