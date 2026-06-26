import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { generateConstitution, writeConstitution, readConstitution, constitutionExists } from "../core/constitution"

export const studio_constitution: ToolDefinition = tool({
  description:
    "Generate or show a project constitution — coding standards auto-derived from detected linters, formatters, " +
      "project type, and conventions. Written to .studio/CONSTITUTION.md and injected into session context.",
  args: {
    action: tool.schema
      .enum(["generate", "show", "status"])
      .describe("generate=analyze project and create constitution | show=display current | status=check if exists"),
    additional_rules: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Extra rules to include in the constitution (for generate action)"),
  },
  async execute(args) {
    const cwd = process.cwd()

    switch (args.action) {
      case "status": {
        const exists = constitutionExists(cwd)
        return exists
          ? "Constitution exists at .studio/CONSTITUTION.md. Use studio_constitution action=show to read it."
          : "No constitution yet. Run studio_constitution action=generate to create one from project analysis."
      }

      case "show": {
        const content = readConstitution(cwd)
        if (!content) return "No constitution yet. Run studio_constitution action=generate to create one."
        return content
      }

      case "generate": {
        const content = generateConstitution({
          root: cwd,
          additionalRules: args.additional_rules,
        })
        const path = writeConstitution(cwd, content)
        return `Constitution generated at ${path}.\n\n${content.slice(0, 2000)}${content.length > 2000 ? "\n\n…(truncated — use studio_constitution show for full)" : ""}`
      }

      default:
        return `Unknown action: ${args.action}`
    }
  },
})
