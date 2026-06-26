import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  listPlans,
  savePlan,
  activatePlan,
  readPlanMarkdown,
  reviseActivePlan,
} from "../core/workspace"
import { PLAN_MARKDOWN_TEMPLATE } from "../core/plan-format"

export const studio_plan: ToolDefinition = tool({
  description: "Create, read, list, activate, or revise structured SDLC plans. Auto-exports to .studio/plans/<id>.md.",
  args: {
    action: tool.schema.enum(["write", "read", "list", "activate", "revise"]).describe("Plan action"),
    name: tool.schema.string().optional().describe("Plan name"),
    content: tool.schema.string().optional().describe("Markdown plan body (write)"),
    goal: tool.schema.string().optional(),
    architecture: tool.schema.string().optional(),
    fileStructure: tool.schema.string().optional(),
    research: tool.schema.array(tool.schema.string()).optional(),
    steps: tool.schema.array(tool.schema.string()).optional(),
    acceptance: tool.schema.array(tool.schema.string()).optional(),
    edgeCases: tool.schema.string().optional(),
    testStrategy: tool.schema.string().optional(),
    reason: tool.schema.string().optional(),
    note: tool.schema.string().optional(),
  },
  async execute(args) {
    if (args.action === "list") {
      const plans = listPlans()
      return plans.length === 0 ? "No plans." : plans.map((p) => `${p.id}: ${p.title}`).join("\n")
    }

    if (!args.name) return "name required"

    if (args.action === "read") {
      try {
        return readPlanMarkdown(args.name)
      } catch {
      /* plan file does not exist */
        return `Plan not found: ${args.name}`
      }
    }

    if (args.action === "activate") {
      try {
        const plan = activatePlan(args.name)
        return `Active plan: ${plan.id}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    }

    if (args.action === "revise") {
      if (!args.reason || !args.note) return "reason and note required"
      const plan = reviseActivePlan(args.reason, args.note)
      return plan ? `Plan revised (${plan.revisions.length} revision(s)).` : "No active plan."
    }

    const hasFields =
      args.goal ||
      args.architecture ||
      args.fileStructure ||
      args.research?.length ||
      args.steps?.length ||
      args.acceptance?.length ||
      args.edgeCases ||
      args.testStrategy

    const plan = savePlan(
      args.name,
      args.content
        ? { markdown: args.content }
        : hasFields
          ? {
              goal: args.goal,
              architecture: args.architecture,
              fileStructure: args.fileStructure,
              research: args.research,
              steps: args.steps?.map((text) => ({ text, done: false })),
              acceptance: args.acceptance,
              edgeCases: args.edgeCases,
              testStrategy: args.testStrategy,
            }
          : { markdown: PLAN_MARKDOWN_TEMPLATE },
    )

    return args.content
      ? `Plan saved: ${plan.id}\n\n${readPlanMarkdown(plan.id)}`
      : `Plan saved: ${plan.id}`
  },
})
