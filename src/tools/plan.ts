import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { studioPath, ensureStudioDirs } from "../core/studio-dir"
import { loadBoulder, saveBoulder } from "../core/tasks"
import { saveArchitectureFromPlan } from "../core/plan-context"


const PLAN_TEMPLATE = `# Plan

## Goal


## Research (docs & examples)
<!-- Official docs, API refs, example repos — cite URLs. Do this BEFORE implementation. -->
- 

## Architecture
<!-- System design, modules, data flow — follow this unless the user changes direction. -->


## File structure
<!-- Key paths, new files, where things live. -->


## Steps
- [ ] 

## Acceptance criteria
- 

## Edge cases & risks


## Test strategy


`

export const studio_plan: ToolDefinition = tool({
  description:
    "Write, read, list, or activate structured work plans in .studio/plans/. Saves architecture/structure for the agent to follow.",
  args: {
    action: tool.schema
      .enum(["write", "read", "list", "activate"])
      .describe("Plan action — activate sets active plan without rewriting"),
    name: tool.schema.string().optional().describe("Plan filename (without .md)"),
    content: tool.schema.string().optional().describe("Markdown content for write"),
  },
  async execute(args) {
    ensureStudioDirs()
    const plansDir = studioPath("plans")

    if (args.action === "list") {
      const files = existsSync(plansDir)
        ? readdirSync(plansDir).filter((f) => f.endsWith(".md"))
        : []
      return files.length === 0 ? "No plans." : files.join("\n")
    }

    if (!args.name) return "name required"

    const file = join(plansDir, `${args.name}.md`)

    if (args.action === "read") {
      if (!existsSync(file)) return `Plan not found: ${args.name}`
      return readFileSync(file, "utf-8")
    }

    if (args.action === "activate") {
      if (!existsSync(file)) return `Plan not found: ${args.name}`
      const b = loadBoulder()
      b.planFile = `${args.name}.md`
      saveBoulder(b)
      saveArchitectureFromPlan(readFileSync(file, "utf-8"))
      return `Active plan: .studio/plans/${args.name}.md (architecture synced)`
    }

    const body = args.content ?? PLAN_TEMPLATE
    writeFileSync(file, body, "utf-8")
    saveArchitectureFromPlan(body)
    const b = loadBoulder()
    b.planFile = `${args.name}.md`
    saveBoulder(b)
    return `Plan written: .studio/plans/${args.name}.md`
  },
})
