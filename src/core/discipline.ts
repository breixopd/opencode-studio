/**
 * Dynamic discipline system prompt — generated from the tool catalog.
 *
 * When a new tool is added to tool-catalog.ts, it automatically appears in
 * the discipline prompt. No manual prompt editing needed.
 *
 * The prompt has:
 *   - Fixed preamble (never changes — stable prefix for prompt cache)
 *   - Dynamic phase list (generated from catalog phases)
 *   - Dynamic tool categories (generated from catalog categories)
 *   - Fixed memory/rules/cost reminders (stable suffix)
 */
import { phaseList, toolListText, TOOL_CATALOG } from "./tool-catalog"

/** Fixed preamble — stable across sessions (prompt-cache friendly). */
const PREAMBLE = `[studio] Real software delivery — act like a senior team.`

/** Fixed reminders — stable suffix. */
const REMINDERS = `When user says "remember …" → studio_remember add immediately.
Handoff requires studio_verify pass. studio_help for any topic. studio_models refresh_all when providers change.`

/**
 * Build the full discipline prompt dynamically from the tool catalog.
 * Called once per session (not per turn) — the result is cached.
 */
let cachedPrompt: string | null = null

export function buildDisciplinePrompt(): string {
  if (cachedPrompt) return cachedPrompt

  const parts: string[] = [PREAMBLE, ""]

  // ——— SDLC Phases (auto-generated from catalog) ————————————————
  parts.push("PHASES (use in order; skip only when trivial):")
  parts.push(phaseList())
  parts.push("")

  // ——— Cross-cutting tool categories (auto-generated) ————————————————
  const categoryLines = toolListText().split("\n")
  // Remove the "# All studio tools" header, keep category lines
  for (const line of categoryLines) {
    if (line && !line.startsWith("#")) parts.push(line)
  }
  parts.push("")

  // ——— Smart automation (fixed — describes the system behavior) ————————
  parts.push("SMART AUTOMATION (zero-config):")
  parts.push("- Auto-detects project type (21+ ecosystems) and configures verify commands")
  parts.push("- Auto-detects formatter/linter and injects conventions into session context")
  parts.push("- LSP diagnostics captured in real-time — agent knows about type errors")
  parts.push("- file.edited → debounced incremental reindex (no full rebuild)")
  parts.push("- session.idle → prune old cost/diagnostics, WAL checkpoint")
  parts.push("- Cross-session resume card + pre-flight cost preview auto-injected")
  parts.push("- Self-healing verify: snapshot HEAD, auto-rollback on persistent failure")
  parts.push("- Self-improving rules: 'don't X' in chat → auto-saved rule")
  parts.push("- Model Council: type 'council:' or /council to trigger multi-lens review")
  parts.push("- Autonomous scout: surfaces polish/test/research opportunities without being asked")
  parts.push("  (studio_scout; opt out: studio_preferences set_autonomy off, or say \"don't scout\")")
  parts.push("- Prefer local models for cheap subagents: studio_preferences set_prefer_local true")
  parts.push("")
  parts.push("AUTONOMY RULES:")
  parts.push("- Default: look for improvements (tests, verify failures, dead code, research gaps)")
  parts.push("- When idle / between tasks: run studio_scout; act on high severity; suggest medium/low")
  parts.push("- Always emphasize verification: write/update tests, run studio_verify before claiming done")
  parts.push("- Never nag if user opted out of autonomy")
  parts.push("")

  // ——— Key tools with when-to-use disambiguation ————————————————
  parts.push("WHEN TO USE (disambiguation for overlapping tools):")
  for (const tool of TOOL_CATALOG) {
    if (tool.whenToUse) {
      parts.push(`- ${tool.name}: ${tool.whenToUse}`)
    }
  }
  parts.push("")

  // ——— Reminders (stable suffix) ————————————————
  parts.push(REMINDERS)

  cachedPrompt = parts.join("\n")
  return cachedPrompt
}

/** Invalidate the cache (call when tools change at runtime). */

/** The discipline prompt, evaluated once at module load (cached). */
export const STUDIO_DISCIPLINE = buildDisciplinePrompt()
