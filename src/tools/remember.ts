import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  addRememberRule,
  removeRememberRule,
  loadRememberRules,
  formatRememberRules,
} from "../core/remember"

export const studio_remember: ToolDefinition = tool({
  description:
    "Persist user rules the agent must follow. When the user says 'remember …', that is an important rule — save it here. Injected every session.",
  args: {
    action: tool.schema.enum(["add", "remove", "list", "show"]).describe("Remember action"),
    rule: tool.schema
      .string()
      .optional()
      .describe("Rule text for add/remove (e.g. 'always run tests before commit')"),
  },
  async execute(args) {
    if (args.action === "list" || args.action === "show") {
      const rules = loadRememberRules()
      if (rules.length === 0) {
        return "No remembered rules. When the user says 'remember …', add it with studio_remember add."
      }
      return formatRememberRules(rules)
    }

    if (!args.rule?.trim()) return "rule required for add/remove"

    if (args.action === "add") {
      const rules = addRememberRule(args.rule)
      return `Remembered (${rules.length} rule(s)):\n${formatRememberRules(rules)}`
    }

    const rules = removeRememberRule(args.rule)
    return rules.length
      ? `Removed. Remaining:\n${formatRememberRules(rules)}`
      : "Rule removed. No rules left."
  },
})
