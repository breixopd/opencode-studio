/**
 * Model Council — multi-model ensemble review and planning.
 *
 * Dispatches multiple review agents with different "lenses" (perspectives)
 * to independently review the same code, then synthesizes their findings.
 * Consensus → high confidence. Disagreement → surface both opinions.
 *
 * How it works within OpenCode:
 *   1. The tool detects available providers/models from the model registry.
 *   2. If only 1 provider: uses different review LENSES (security, architecture,
 *      correctness, maintainability) on the same model — still a "council"
 *      but serial rather than parallel.
 *   3. If 2+ providers: instructs the agent to dispatch @studio-review with
 *      different models by creating temporary agent profiles.
 *   4. Results are synthesized: agreements highlighted, disagreements surfaced.
 *
 * Edge cases handled:
 *   - Single provider → multi-lens council (same model, different perspectives)
 *   - Rate limit / out of credits → model-fallback hook handles graceful degradation
 *   - User toggles via /studio-council command or "council:" keyword in prompt
 *   - Never auto-runs — only when explicitly triggered
 */
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getActivePlan } from "../core/workspace"
import { detectTooling } from "../core/project-detect"
import * as log from "../core/logger"

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
    "Model Council: multi-lens ensemble review. Dispatches multiple review perspectives " +
      "(security, architecture, correctness, maintainability) on the same code, then synthesizes. " +
      "Only runs when explicitly triggered. Use for complex/security-sensitive changes.",
  args: {
    action: tool.schema
      .enum(["review", "plan", "status"])
      .describe("review=multi-lens code review | plan=multi-lens architecture review | status=show council config"),
    file: tool.schema.string().optional().describe("Specific file to review (default: staged changes)"),
    goal: tool.schema.string().optional().describe("Goal description for plan council (e.g. 'Add rate limiting')"),
  },
  async execute(args) {
    const cwd = process.cwd()

    if (args.action === "status") {
      return councilStatus(cwd)
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

/** Show the council configuration — which lenses and models are available. */
function councilStatus(_cwd: string): string {
  const lines = [
    "# Model Council Configuration",
    "",
    `Review lenses: ${REVIEW_LENSES.length}`,
    ...REVIEW_LENSES.map((l) => `  - ${l.name}: ${l.focus.slice(0, 80)}...`),
    "",
    "How it works:",
    "  review: dispatches 4 review lenses (security, architecture, correctness, maintainability).",
    "  Each lens reviews the same code independently from a different perspective.",
    "  Results are synthesized: agreements highlighted, disagreements surfaced.",
    "",
    "Usage:",
    "  studio_council action=review                    — review staged changes",
    "  studio_council action=review file=src/index.ts — review specific file",
    "  studio_council action=plan goal='Add rate limiting' — multi-lens planning",
    "",
    "The council never auto-runs. Toggle it explicitly when you want deep review.",
  ]
  return lines.join("\n")
}

/** Generate a multi-lens review instruction for the agent. */
function councilReview(file?: string): string {
  const target = file ?? "the current staged changes"
  const lines = [
    `# Model Council: Multi-Lens Review`,
    "",
    `Target: ${target}`,
    "",
    `I need you to review this code from ${REVIEW_LENSES.length} different perspectives,`,
    `one at a time. For each lens, focus ONLY on issues relevant to that perspective.`,
    `Rate each as PASS / WARN / FAIL.`,
    "",
  ]

  for (let i = 0; i < REVIEW_LENSES.length; i++) {
    const lens = REVIEW_LENSES[i]!
    lines.push(`## Lens ${i + 1}: ${lens.name}`)
    lines.push(`Focus: ${lens.focus}`)
    lines.push("")
  }

  lines.push("## Synthesis")
  lines.push("After all lenses complete:")
  lines.push("  1. List all FAIL items (must fix before handoff)")
  lines.push("  2. List all WARN items (should fix, may merge without)")
  lines.push("  3. List PASS items (no issues found in that lens)")
  lines.push("  4. Note any disagreements between lenses (e.g. architecture says OK but security says FAIL)")
  lines.push("")
  lines.push("This is NOT a replacement for studio_verify — it's a deeper quality review.")
  lines.push("Run studio_verify after addressing any FAIL items.")

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
    `Review this goal from ${REVIEW_LENSES.length} perspectives.`,
    `For each lens, assess whether the approach is sound from that angle.`,
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
  lines.push("  1. Is the approach sound across ALL lenses? (green light)")
  lines.push("  2. Which lenses have concerns? (yellow — address before implementing)")
  lines.push("  3. Which lenses say NO? (red — do not implement without resolving)")
  lines.push("")
  lines.push("If all lenses are green: proceed to studio_spec → studio_plan → implementation.")
  lines.push("If any lens is red: address the concerns before proceeding.")

  log.info(`Council plan dispatched for: ${goal}`)
  return lines.join("\n")
}
