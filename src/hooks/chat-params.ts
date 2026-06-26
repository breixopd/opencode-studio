import { tierForAgent } from "../core/agent-tiers"

/**
 * Chat params hook — temperature tiering + prompt-cache key.
 *
 * The cache key is a stable hash of the project root + agent name + studio
 * version. Anthropic/OpenAI use this to identify cacheable prompt prefixes.
 * The discipline hook orders system blocks so the stable prefix (discipline +
 * project profile + rules) comes before the dynamic suffix (plan/tasks/verify).
 */
export function createChatParamsHook() {
  return async (
    input: {
      sessionID: string
      agent: string
    },
    output: {
      temperature: number
      topP: number
      topK: number
      maxOutputTokens: number | undefined
      options: Record<string, unknown>
    },
  ) => {
    const tier = tierForAgent(input.agent)
    if (tier === "fast") {
      output.temperature = Math.min(output.temperature, 0.25)
    } else if (tier === "reason") {
      output.temperature = Math.max(output.temperature, 0.45)
    } else if (tier === "code") {
      output.temperature = 0.35
    }

    // Prompt cache key: stable per (project, agent, studio version).
    // Both Anthropic and OpenAI benefit from stable prompt prefixes; this key
    // helps identify what CAN be cached. The actual caching is driven by the
    // stable-prefix ordering in the discipline hook.
    output.options.cache_key = `studio:${process.cwd()}:${input.agent}:v2`
  }
}
