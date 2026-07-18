import type { ModelTier } from "./model-catalog"
import { AGENT_DEFS } from "./agent-defs"

/** All studio agent names — derived from AGENT_DEFS (single source of truth). */
export const STUDIO_AGENT_NAMES = AGENT_DEFS.map((d) => d.name)

export type StudioAgentName = (typeof AGENT_DEFS)[number]["name"]

export const READ_ONLY_AGENTS = new Set<string>([
  "studio-explore",
  "studio-research",
  "studio-verify",
  "studio-scout",
])
export const REASON_AGENTS = new Set<string>([
  "studio-architect",
  "studio-security",
  "studio-review",
])
export const CODE_AGENTS = new Set<string>(["studio-implement", "studio-remote"])

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
