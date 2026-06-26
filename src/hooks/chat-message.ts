import { setSessionMainModel } from "../core/session-model"
import { refreshModelRouting } from "../core/model-routing"
import { addRule } from "../core/workspace"
import * as log from "../core/logger"

const MAIN_AGENTS = new Set(["build", "general", "plan"])

/**
 * Correction patterns that indicate the user is telling the agent to NOT do something.
 * When detected, we extract a rule and write it to studio rules for future sessions.
 *
 * Patterns (case-insensitive):
 *   "don't X"          → "Don't X"
 *   "never X"          → "Never X"
 *   "stop doing X"     → "Stop doing X"
 *   "no, don't X"      → "Don't X"
 *   "instead of X, do Y" → "Prefer Y over X"
 */
const CORRECTION_RE = /\b(?:don'?t|never|stop doing|no,\s*don'?t|always)\s+([a-z][a-z\s'-]{4,80})/gi

export function createChatMessageHook() {
  return async (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
    },
    output: {
      message: { role: string; content?: unknown }
      parts: Array<{ type: string; text?: string }>
    },
  ) => {
    if (input.model && input.sessionID) {
      const agent = input.agent ?? "build"
      const isMain = !agent.startsWith("studio-") && MAIN_AGENTS.has(agent)
      if (isMain) {
        setSessionMainModel(input.sessionID, input.model.providerID, input.model.modelID)
        await refreshModelRouting()
      }
    }

    // Self-improving rule capture (Tier S #5).
    // Only inspect user messages (not assistant).
    if (!output.message || output.message.role !== "user") return

    // Extract text from parts (more reliable than message.content).
    const text = output.parts
      ?.filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join(" ")
      .trim()

    if (!text || text.length < 10) return

    const rules = extractRules(text)
    for (const rule of rules) {
      try {
        const updated = addRule(rule)
        log.info(`Auto-captured rule: "${rule}" (${updated.length} rules total)`)
      } catch {
        /* rule already exists — deduped by UNIQUE constraint */
      }
    }
  }
}

/** Extract correction rules from user message text. */
function extractRules(text: string): string[] {
  const rules: string[] = []
  let match: RegExpExecArray | null
  CORRECTION_RE.lastIndex = 0
  while ((match = CORRECTION_RE.exec(text)) !== null) {
    const action = match[1].trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "")
    if (action.length < 5) continue
    // Capitalize: "don't forget" → "Don't forget"
    const prefix = match[0].split(/\s/)[0].replace(/no,?\s*/i, "")
    rules.push(`${prefix.charAt(0).toUpperCase() + prefix.slice(1)} ${action}`)
    if (rules.length >= 3) break // don't over-capture from a long message
  }
  return rules
}
