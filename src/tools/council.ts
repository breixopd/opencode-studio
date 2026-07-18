/**
 * Model Council — multi-lens ensemble review and planning.
 *
 * Dispatches multiple review lenses (perspectives) on the same code, then
 * synthesizes their findings. Consensus → high confidence. Disagreement →
 * surface both opinions.
 *
 * How it works within OpenCode:
 *   1. /council slash command OR "council:" keyword in prompt triggers it
 *   2. The tool generates a structured review prompt with 4 lenses
 *   3. The agent reviews from each lens perspective independently
 *   4. Results are synthesized: FAIL items must fix, WARN should fix, PASS ok
 *   5. If FAIL items found → auto-creates tasks for each issue
 *   6. Disagreements between lenses are surfaced explicitly
 *
 * Edge cases handled:
 *   - Single provider → multi-lens council (same model, different perspectives)
 *   - Rate limit / out of credits → model-fallback hook handles graceful degradation
 *   - Never auto-runs — only when explicitly triggered via /council or keyword
 *   - After review: creates tasks for FAIL items, suggests studio_verify
 */
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getActivePlan } from "../core/workspace"
import { detectTooling } from "../core/project-detect"
import { COUNCIL_KEYWORD } from "../core/council-intent"
import * as log from "../core/logger"
import { getActiveDirectory } from "../core/active-dir"

// Re-export for callers that imported from tools/council
export { COUNCIL_KEYWORD, isCouncilTriggered } from "../core/council-intent"

/** Review lenses — each provides a different perspective on the same code. */
const REVIEW_LENSES = [
  {
    name: "Security",
    focus: "OWASP risks, injection vectors, authn/z flaws, secrets exposure, dependency vulnerabilities. Check every external input path. Flag: hardcoded credentials, SQL injection, XSS, missing auth on endpoints, insecure deserialization.",
  },
  {
    name: "Architecture",
    focus: "Module boundaries, coupling, cohesion, data flow, separation of concerns. Is the code in the right place? Does it create circular dependencies? Is the abstraction level correct? Flag: god objects, tight coupling, missing interfaces.",
  },
  {
    name: "Correctness",
    focus: "Logic errors, edge cases, null/undefined handling, off-by-one, race conditions. Does it handle empty input? Boundary values? Error paths? Flag: untested branches, missing error handling, incorrect type assumptions.",
  },
  {
    name: "Maintainability",
    focus: "Readability, naming, function length, duplication, test coverage, documentation. Will the next developer understand this? Flag: functions >50 lines, magic numbers, unclear naming, missing tests, commented-out code.",
  },
] as const

export const studio_council: ToolDefinition = tool({
  description:
    "Model Council: multi-lens ensemble review (security, architecture, correctness, maintainability). " +
      "Triggered via /council command or 'council:' keyword in prompt. " +
      "Creates tasks for FAIL items after review. Never auto-runs.",
  args: {
    action: tool.schema
      .enum(["review", "plan", "status"])
      .describe("review=multi-lens code review | plan=multi-lens architecture review | status=show council config"),
    file: tool.schema.string().optional().describe("Specific file to review (default: staged changes)"),
    goal: tool.schema.string().optional().describe("Goal description for plan council (e.g. 'Add rate limiting')"),
  },
  async execute(args) {
    const cwd = getActiveDirectory()

    if (args.action === "status") {
      return councilStatus()
    }

    if (args.action === "review") {
      return councilReview(args.file)
    }

    if (args.action === "plan") {
      if (!args.goal) return "goal required for plan council"
      return councilPlan(args.goal, cwd)
    }

    return `Unknown action: ${args.action}`
  },
})

/** Show the council configuration. */
function councilStatus(): string {
  const lines = [
    "# Model Council Configuration",
    "",
    `Review lenses: ${REVIEW_LENSES.length}`,
    ...REVIEW_LENSES.map((l) => `  - ${l.name}: ${l.focus.slice(0, 80)}...`),
    "",
    "Trigger methods:",
    "  /council <args>           — slash command (reviews staged changes)",
    "  /council plan <goal>     — slash command for planning",
    `  '${COUNCIL_KEYWORD} <text>' — keyword in any message`,
    "  studio_council action=review — direct tool call",
    "",
    "What happens after council runs:",
    "  1. Each lens independently reviews from its perspective",
    "  2. Results synthesized: PASS (ok) / WARN (should fix) / FAIL (must fix)",
    "  3. FAIL items are automatically created as studio_task entries",
    "  4. Disagreements between lenses are surfaced",
    "  5. Run studio_verify after fixing FAIL items",
    "",
    "The council never auto-runs. Only when you explicitly trigger it.",
  ]
  return lines.join("\n")
}

/**
 * Generate a multi-lens review instruction for the agent.
 * After the review, instructs the agent to:
 *   - Create tasks for FAIL items
 *   - Suggest running studio_verify
 *   - Surface disagreements between lenses
 */
function councilReview(file?: string): string {
  const target = file ?? "the current staged changes"
  const lines = [
    `# Model Council: Multi-Lens Review`,
    "",
    `Target: ${target}`,
    "",
    `Review this code from ${REVIEW_LENSES.length} different perspectives,`,
    `one at a time. For each lens, focus ONLY on issues relevant to that perspective.`,
    `Rate each finding as PASS / WARN / FAIL.`,
    "",
  ]

  for (let i = 0; i < REVIEW_LENSES.length; i++) {
    const lens = REVIEW_LENSES[i]!
    lines.push(`## Lens ${i + 1}: ${lens.name}`)
    lines.push(`Focus: ${lens.focus}`)
    lines.push("")
  }

  lines.push("## Synthesis (complete after all lenses)")
  lines.push("After all lenses complete:")
  lines.push("  1. List all FAIL items (must fix before handoff)")
  lines.push("  2. List all WARN items (should fix, may merge without)")
  lines.push("  3. List PASS items (no issues found in that lens)")
  lines.push("  4. Note disagreements between lenses (e.g. architecture says OK but security says FAIL)")
  lines.push("")
  lines.push("## Action (auto-execute after synthesis)")
  lines.push("  1. For each FAIL item: studio_task create with title and acceptance criteria")
  lines.push("  2. Print the task IDs so they can be tracked")
  lines.push("  3. Summarize: 'N FAIL items → N tasks created. Fix them, then studio_verify.'")
  lines.push("")
  lines.push("This is NOT a replacement for studio_verify — it's a deeper quality review.")

  log.info("Council review dispatched")
  return lines.join("\n")
}

/** Generate a multi-lens architecture review for a new feature/goal. */
function councilPlan(goal: string, cwd: string): string {
  const { projectType } = detectTooling(cwd)
  const plan = getActivePlan()

  const lines = [
    `# Model Council: Multi-Lens Architecture Review`,
    "",
    `Goal: ${goal}`,
    `Ecosystem: ${projectType.ecosystem}`,
    ...(plan ? [`Active plan: ${plan.title}`] : ["No active plan — this is a new proposal"]),
    "",
    `Assess this goal from ${REVIEW_LENSES.length} perspectives.`,
    `For each lens, determine if the approach is sound from that angle.`  ,
    "",
  ]

  for (let i = 0; i < REVIEW_LENSES.length; i++) {
    const lens = REVIEW_LENSES[i]!
    lines.push(`## Lens ${i + 1}: ${lens.name}`)
    lines.push(`Assess the goal from a ${lens.name.toLowerCase()} perspective.`)
    lines.push(`Focus: ${lens.focus}`)
    lines.push("")
  }

  lines.push("## Synthesis")
  lines.push("After all lenses:")
  lines.push("  1. Is the approach sound across ALL lenses? (green light → proceed)")
  lines.push("  2. Which lenses have concerns? (yellow — address before implementing)")
  lines.push("  3. Which lenses say NO? (red — do not implement without resolving)")
  lines.push("")
  lines.push("## Action")
  lines.push("  - If all green: proceed to studio_spec → studio_plan → implementation")
  lines.push("  - If yellow: create tasks for each concern, address before implementing")
  lines.push("  - If red: explain why, do not proceed without user direction")

  log.info(`Council plan dispatched for: ${goal}`)
  return lines.join("\n")
}
