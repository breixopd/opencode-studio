import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { addRule, removeRule, listRules, formatRules } from "../core/workspace"
import { addGlobalRule, loadUserProfile } from "../core/project-profile"

export const studio_remember: ToolDefinition = tool({
  description:
    "Persist rules. 'remember …' from user = important. scope=project (this repo) or global (all projects).",
  args: {
    action: tool.schema.enum(["add", "remove", "list", "show"]).describe("Remember action"),
    rule: tool.schema.string().optional().describe("Rule text"),
    scope: tool.schema
      .enum(["project", "global"])
      .optional()
      .describe("project = this repo (.studio); global = all sessions (default: project)"),
  },
  async execute(args) {
    const scope = args.scope ?? "project"

    if (args.action === "list" || args.action === "show") {
      const project = listRules()
      const global = loadUserProfile().globalRules
      const lines: string[] = []
      if (global.length) lines.push("Global:\n" + global.map((r) => `- ${r}`).join("\n"))
      if (project.length) lines.push("Project:\n" + formatRules(project))
      return lines.length ? lines.join("\n\n") : "No rules. Use studio_remember add when user says remember."
    }

    if (!args.rule?.trim()) return "rule required for add/remove"

    if (args.action === "add") {
      if (scope === "global") {
        const rules = addGlobalRule(args.rule)
        return `Global rule saved (${rules.length}):\n` + rules.map((r) => `- ${r}`).join("\n")
      }
      const rules = addRule(args.rule)
      return `Project rule saved (${rules.length}):\n${formatRules(rules)}`
    }

    if (scope === "global") {
      return "remove for global rules: edit ~/.config/opencode-studio/user.json"
    }

    const rules = removeRule(args.rule)
    return rules.length ? `Removed.\n${formatRules(rules)}` : "Rule removed."
  },
})
