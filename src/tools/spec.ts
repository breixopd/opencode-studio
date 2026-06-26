import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { savePlan, createTask, activatePlan, getActivePlan } from "../core/workspace"
import { detectTooling } from "../core/project-detect"

export interface SpecSection {
  heading: string
  items: string[]
}

export interface StructuredSpec {
  goal: string
  requirements: string[]
  acceptanceCriteria: string[]
  architectureNotes: string
  taskBreakdown: Array<{ title: string; acceptance: string[] }>
  risks: string[]
}

/** Detect common feature patterns in the goal and produce concrete requirements. */
function extractRequirements(goal: string, ecosystem: string): string[] {
  const goalLower = goal.toLowerCase()
  const requirements: string[] = []

  if (goalLower.match(/api|endpoint|route/)) {
    requirements.push("Define input schema with validation (types + runtime checks)")
    requirements.push("Return structured error responses with consistent format")
    requirements.push("Add authentication/authorization if handling sensitive data")
    if (ecosystem === "Rust" || ecosystem === "Go") {
      requirements.push("Use framework-idiomatic middleware/handler pattern")
    }
  }
  if (goalLower.match(/ui|component|page|screen|view/)) {
    requirements.push("Responsive design — works on mobile/tablet/desktop")
    requirements.push("Accessible (keyboard nav, ARIA labels, semantic HTML)")
    requirements.push("Loading + error states for all async operations")
  }
  if (goalLower.match(/database|model|schema|migration/)) {
    requirements.push("Write migration with rollback support")
    requirements.push("Add indexes for expected query patterns")
    requirements.push("Validate at the model layer, not just the API layer")
  }
  if (goalLower.match(/auth|login|session|token/)) {
    requirements.push("Use constant-time comparison for secrets/tokens")
    requirements.push("Expire + rotate tokens; allow revocation")
    requirements.push("Never log or expose secrets in responses")
  }
  if (goalLower.match(/real.?time|websocket|sse|stream/)) {
    requirements.push("Handle reconnection on connection loss")
    requirements.push("Backpressure: handle slow consumers gracefully")
  }

  if (!requirements.length) requirements.push(`Implement: ${goal}`)
  requirements.push("Write tests before implementation (TDD)")
  requirements.push("Follow existing project conventions (see studio profile)")
  return requirements
}

/** Generate acceptance criteria, extended by detected feature patterns. */
function extractAcceptance(goal: string): string[] {
  const goalLower = goal.toLowerCase()
  const acceptanceCriteria: string[] = [
    "All tests pass (studio_verify)",
    "No new type errors (LSP diagnostics clean)",
    "Code follows existing style (formatter check passes)",
    "Edge cases covered: empty input, boundary values, error paths",
  ]
  if (goalLower.match(/api|endpoint/)) {
    acceptanceCriteria.push("Returns correct response for valid input")
    acceptanceCriteria.push("Returns 4xx for invalid input with helpful error messages")
    acceptanceCriteria.push("Handles concurrent requests without data corruption")
  }
  if (goalLower.match(/ui|component/)) {
    acceptanceCriteria.push("Renders without console errors")
    acceptanceCriteria.push("Keyboard navigation works")
  }
  return acceptanceCriteria
}

/** Ecosystem-specific architecture notes. */
function extractArchitectureNotes(ecosystem: string): string[] {
  const notes: string[] = []
  if (ecosystem === "Rust") {
    notes.push("Consider ownership/borrowing implications early")
    notes.push("Use thiserror for error types, anyhow for app-level")
  }
  if (ecosystem === "Python") {
    notes.push("Use type hints, prefer pathlib over os.path")
    notes.push("Structure as a package, not flat scripts")
  }
  if (ecosystem === "Go") {
    notes.push("Keep interfaces small, accept interfaces return structs")
    notes.push("Use context for cancellation/timeout")
  }
  if (ecosystem === "Bun" || ecosystem === "Node") {
    notes.push("Use async/await, avoid callback patterns")
    notes.push("Keep modules focused — one responsibility per file")
  }
  return notes
}

/** Generate a TDD-flavored task breakdown. */
function extractTaskBreakdown(goal: string): Array<{ title: string; acceptance: string[] }> {
  const goalLower = goal.toLowerCase()
  const taskBreakdown: Array<{ title: string; acceptance: string[] }> = [
    { title: `Write tests for: ${goal}`, acceptance: ["Test file exists and covers happy path + 2 edge cases"] },
    { title: `Implement core logic for: ${goal}`, acceptance: ["All tests pass", "No type errors"] },
    { title: `Add error handling for: ${goal}`, acceptance: ["Error states tested", "Errors are user-friendly"] },
    { title: `Integrate with existing codebase`, acceptance: ["No regressions in existing tests", "Follows project conventions"] },
  ]
  if (goalLower.match(/api|endpoint/)) {
    taskBreakdown.splice(1, 0, { title: "Define API schema/types", acceptance: ["Input/output types defined", "Validation in place"] })
  }
  return taskBreakdown
}

/** Generate risks keyed off sensitive keywords in the goal. */
function extractRisks(goal: string): string[] {
  const goalLower = goal.toLowerCase()
  const risks: string[] = []
  if (goalLower.match(/migration|schema/)) risks.push("Migration may fail on existing data — test against realistic data")
  if (goalLower.match(/auth|security/)) risks.push("Security-sensitive — get @studio-security review before handoff")
  if (goalLower.match(/performance|cache|optimize/)) risks.push("Optimization may introduce regressions — benchmark before/after")
  return risks
}

/**
 * Generate a structured spec from a feature goal description.
 * This is a heuristic generator — the agent should review and refine.
 *
 * The spec is intentionally lightweight (not a full PRD): it ensures the agent
 * works against concrete requirements with acceptance criteria rather than
 * vibing its way through implementation.
 */
function generateSpec(goal: string, ecosystem: string): StructuredSpec {
  return {
    goal,
    requirements: extractRequirements(goal, ecosystem),
    acceptanceCriteria: extractAcceptance(goal),
    architectureNotes: extractArchitectureNotes(ecosystem).join("\n"),
    taskBreakdown: extractTaskBreakdown(goal),
    risks: extractRisks(goal),
  }
}

export const studio_spec: ToolDefinition = tool({
  description:
    "Generate a structured spec from a feature goal — requirements, acceptance criteria, task breakdown, risks. " +
      "Feeds into studio_plan and studio_task. Ensures implementation works against concrete requirements, not vibes.",
  args: {
    action: tool.schema
      .enum(["create", "show"])
      .describe("create=generate spec + create plan + tasks; show=display active spec"),
    goal: tool.schema
      .string()
      .optional()
      .describe("Feature goal description (required for create): e.g. 'Add rate limiting to the API'"),
    create_plan: tool.schema
      .boolean()
      .optional()
      .describe("Also create a studio_plan + studio_tasks from the spec (default true)"),
  },
  async execute(args) {
    if (args.action === "show") {
      const plan = getActivePlan()
      if (!plan) return "No active plan. Use studio_spec create to generate one from a goal."
      return `## Spec: ${plan.title}\n\n**Goal:** ${plan.goal}\n\n**Acceptance:**\n${plan.acceptance.map((a) => `- ${a}`).join("\n")}\n\nUse studio_plan read for full details.`
    }

    if (!args.goal?.trim()) return "goal required for create: describe the feature you want to build"

    const goal = args.goal.trim()
    const { projectType } = detectTooling(process.cwd())
    const spec = generateSpec(goal, projectType.ecosystem)

    const lines: string[] = [
      `# Spec: ${goal}`,
      ``,
      `**Ecosystem:** ${projectType.ecosystem} (${projectType.confidence} confidence)`,
      ``,
      `## Requirements`,
      ...spec.requirements.map((r) => `- ${r}`),
      ``,
      `## Acceptance criteria`,
      ...spec.acceptanceCriteria.map((a) => `- ${a}`),
      ``,
      `## Architecture notes`,
      spec.architectureNotes || "(none specific)",
      ``,
      `## Task breakdown`,
      ...spec.taskBreakdown.map((t, i) => `${i + 1}. ${t.title}`),
    ]

    if (spec.risks.length) {
      lines.push("", `## Risks`, ...spec.risks.map((r) => `- ${r}`))
    }

    // Optionally create a plan + tasks from the spec.
    if (args.create_plan !== false) {
      const planName = goal.slice(0, 48).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "spec"
      const plan = savePlan(planName, {
        goal,
        research: spec.requirements,
        architecture: spec.architectureNotes,
        acceptance: spec.acceptanceCriteria,
        edgeCases: spec.risks.join("\n"),
        testStrategy: "TDD — write tests first, then implement against the spec requirements",
      })
      activatePlan(plan.id)

      // Create tasks from the breakdown.
      const tasks = spec.taskBreakdown.map((t) =>
        createTask(t.title, t.acceptance),
      )

      lines.push(
        "",
        `## Created`,
        `- Plan: ${plan.id} (${plan.title})`,
        `- Tasks: ${tasks.length} created`,
        "",
        "Review with studio_plan read, then start implementing. Use studio_task list to see all tasks.",
      )
    }

    return lines.join("\n")
  },
})
