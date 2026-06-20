import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { writeFileSync } from "fs"
import { studioPath, ensureStudioDirs } from "../core/studio-dir"
import { incompleteTasks, loadBoulder } from "../core/tasks"
import { loadArchitectureText } from "../core/plan-context"

export const studio_handoff: ToolDefinition = tool({
  description:
    "Write a structured handoff report: what was done, files changed, tests, risks, next steps.",
  args: {
    summary: tool.schema.string().describe("What was accomplished"),
    files_changed: tool.schema.array(tool.schema.string()).optional(),
    tests_run: tool.schema.string().optional(),
    risks: tool.schema.string().optional(),
    next_steps: tool.schema.string().optional(),
  },
  async execute(args) {
    ensureStudioDirs()
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    const open = incompleteTasks()
    const boulder = loadBoulder()
    const arch = loadArchitectureText()

    const md = `# Handoff ${ts}

## Summary
${args.summary}

## Plan adherence
${boulder.planFile ? `Active plan: ${boulder.planFile}` : "No active plan."}
${arch ? `\n${arch}` : ""}

## Files changed
${(args.files_changed ?? []).map((f) => `- ${f}`).join("\n") || "- (none listed)"}

## Tests
${args.tests_run ?? "Not run — use studio_verify before handoff."}

## Risks / edge cases
${args.risks ?? "None noted."}

## Next steps
${args.next_steps ?? "None."}

## Open tasks
${open.length === 0 ? "All tasks complete." : open.map((t) => `- [ ] ${t.id}: ${t.title}`).join("\n")}
`
    const path = studioPath("handoffs", `${ts}.md`)
    writeFileSync(path, md, "utf-8")
    return `Handoff saved: ${path}\n\n${md}`
  },
})
