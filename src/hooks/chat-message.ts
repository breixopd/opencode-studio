import { setSessionMainModel } from "../core/model-routing"
import { refreshModelRouting } from "../core/model-routing"
import { addRule } from "../core/workspace"
import { addGlobalRule } from "../core/project-profile"
import { recordCorrection, routeScope, getRecurringPatterns } from "../core/auto-memory"
import { isCouncilTriggered } from "../core/council-intent"
import { detectAutonomyIntent } from "../core/scout"
import {
  setAutonomyMode,
  setSessionBudgetUsd,
  acceptAutonomyFullRisk,
  clearAutonomyFullRisk,
  detectAutonomyRiskIntent,
} from "../core/project-profile"
import { detectBudgetIntent } from "../core/budget-intent"
import * as log from "../core/logger"

const MAIN_AGENTS = new Set(["build", "general", "plan"])

/**
 * Self-improving rule capture + smart scope routing + pattern detection.
 *
 * When the user says "don't X" / "never Y" / "always Z" in chat:
 *   1. Extract the rule from the correction
 *   2. Route it to the right scope (project vs global) based on content
 *   3. Record the correction for pattern tracking
 *   4. If the same correction recurs ≥3 times, surface a "make permanent" suggestion
 *   5. Save to the appropriate store (SQLite rules or global user.json)
 */
const CORRECTION_RE = /\b(?:don'?t|never|stop doing|no,\s*don'?t|always|prefer|avoid)\s+([a-z][a-z\s'-]{4,80})/gi

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

    // Self-improving rule capture — only inspect user messages.
    if (!output.message || output.message.role !== "user") return

    const text = output.parts
      ?.filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join(" ")
      .trim()

    if (!text || text.length < 5) return

    // Council keyword detection — if the user types "council:" in their message,
    // log it so the TUI can toast and the agent knows to run the council.
    if (isCouncilTriggered(text)) {
      log.info(`Council keyword detected in user message`)
      // The keyword is just a signal — the agent will see "council:" in the
      // message and should call studio_council action=review. The chat-message
      // hook can't dispatch tools directly, but the discipline prompt mentions
      // the keyword, so the agent knows what to do.
    }

    // Risk accept / revoke before autonomy mode (same message can accept then enable full).
    const riskIntent = detectAutonomyRiskIntent(text)
    if (riskIntent === "accept") {
      acceptAutonomyFullRisk()
      log.info("Full-autonomy risk accepted via chat")
    } else if (riskIntent === "clear") {
      clearAutonomyFullRisk()
      log.info("Full-autonomy risk cleared via chat")
    }

    // Natural-language autonomy opt-in/out ("don't scout", "be proactive", …).
    const autonomyIntent = detectAutonomyIntent(text)
    if (autonomyIntent) {
      try {
        setAutonomyMode(autonomyIntent)
        log.info(`Autonomy mode set via chat: ${autonomyIntent}`)
      } catch (err) {
        log.info(`Autonomy mode via chat refused: ${(err as Error).message}`)
      }
    }

    // "budget $5" / "clear budget" / "disable budget" / "unlimited budget"
    const budgetIntent = detectBudgetIntent(text)
    if (budgetIntent?.kind === "clear") {
      setSessionBudgetUsd(null)
      log.info("Session budget cleared via chat (unlimited)")
    } else if (budgetIntent?.kind === "set") {
      setSessionBudgetUsd(budgetIntent.usd)
      log.info(`Session budget set via chat: $${budgetIntent.usd}`)
    }

    const rules = extractRules(text)
    for (const rule of rules) {
      try {
        // Smart scope routing — project-specific vs global preference.
        const scope = routeScope(rule)

        // Record for pattern tracking (detects recurring corrections).
        const pattern = recordCorrection(rule, scope)

        if (scope === "global") {
          addGlobalRule(rule)
          log.info(`Auto-captured GLOBAL rule: "${rule}"`)
        } else {
          addRule(rule)
          log.info(`Auto-captured PROJECT rule: "${rule}"`)
        }

        // If this correction recurs, log the suggestion.
        if (pattern.isRecurring) {
          log.info(`Recurring correction (${pattern.count}x): ${pattern.suggestion}`)
        }
      } catch (err) {
      log.debugCatch("src/hooks/chat-message.ts", err);
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

    // Determine the prefix word (don't, never, always, prefer, avoid)
    const prefixWord = match[0].split(/\s/)[0].replace(/no,?\s*/i, "")
    const capitalized = prefixWord.charAt(0).toUpperCase() + prefixWord.slice(1)
    rules.push(`${capitalized} ${action}`)
    if (rules.length >= 3) break /* don't over-capture from a long message */
  }
  return rules
}

/** Get recurring patterns for the discipline hook to surface. */
export function getRecurringCorrectionNotices(): string | null {
  const patterns = getRecurringPatterns()
  if (!patterns || patterns.length === 0) return null
  const lines = ["[studio patterns] Recurring user corrections detected:"]
  for (const p of patterns) {
    lines.push(`  ${p.count}x: "${p.rule.slice(0, 80)}" → already saved as ${p.scope} rule`)
  }
  return lines.join("\n")
}
