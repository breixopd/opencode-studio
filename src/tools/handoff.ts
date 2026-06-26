import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { canHandoff, incompleteTasks, saveHandoff, getActivePlan, activeArchitectureText } from "../core/workspace"
import { syncHandoffToProfile } from "../core/project-profile"

export const studio_handoff: ToolDefinition = tool({
  description:
    "Write a structured handoff report. Requires studio_verify pass (or force:true). Updates cross-session project profile.",
  args: {
    summary: tool.schema.string().describe("What was accomplished"),
    files_changed: tool.schema.array(tool.schema.string()).optional(),
    tests_run: tool.schema.string().optional(),
    risks: tool.schema.string().optional(),
    next_steps: tool.schema.string().optional(),
    force: tool.schema
      .boolean()
      .optional()
      .describe("Override verify/task gate (use only when intentional)"),
  },
  async execute(args) {
    const gate = canHandoff(args.force === true)
    if (!gate.ok) {
      return `Handoff blocked: ${gate.reason}\nRun studio_verify first, complete open tasks, or pass force:true.`
    }

    const open = incompleteTasks()
    const plan = getActivePlan()
    const arch = activeArchitectureText()

    const handoff = saveHandoff({
      summary: args.summary,
      filesChanged: args.files_changed ?? [],
      testsRun: args.tests_run,
      risks: args.risks,
      nextSteps: args.next_steps,
      planId: plan?.id,
    })

    syncHandoffToProfile(handoff)

    const md = `# Handoff ${handoff.createdAt}

## Summary
${args.summary}

## Plan adherence
${plan ? `Active plan: ${plan.id} (${plan.title})` : "No active plan."}
${arch ? `\n${arch}` : ""}

## Files changed
${(args.files_changed ?? []).map((f) => `- ${f}`).join("\n") || "- (none listed)"}

## Tests
${args.tests_run ?? "Verified via studio_verify."}

## Risks / edge cases
${args.risks ?? "None noted."}

## Next steps
${args.next_steps ?? "None."}

## Open tasks
${open.length === 0 ? "All tasks complete." : open.map((t) => `- [ ] ${t.id}: ${t.title}`).join("\n")}
`
    return `Handoff saved (id: ${handoff.id}). Project profile updated.\n\n${md}`
  },
})
