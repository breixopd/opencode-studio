import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { addRule, removeRule, listRules, formatRules } from "../core/workspace"
import { addGlobalRule, loadUserProfile } from "../core/project-profile"
import {
  saveMemory, readMemoryTopic, listMemoryTopics, hasSimilarMemory,
  type MemoryTopic,
} from "../core/auto-memory"

const VALID_TOPICS: MemoryTopic[] = ["debugging", "conventions", "architecture", "build-commands", "preferences", "insights"]

export const studio_remember: ToolDefinition = tool({
  description:
    "Persist rules + auto-memory. scope=project (this repo) or global (all projects). " +
      "action=memory saves agent-driven learnings to topic files. action=topic reads a specific topic.",
  args: {
    action: tool.schema
      .enum(["add", "remove", "list", "show", "memory", "topic", "topics"])
      .describe("add/remove/list rules | memory=save agent learning | topic=read topic file | topics=list topics"),
    rule: tool.schema.string().optional().describe("Rule text (add/remove) or memory content (memory)"),
    scope: tool.schema
      .enum(["project", "global"])
      .optional()
      .describe("project = this repo; global = all sessions. Auto-detected if omitted."),
    topic: tool.schema
      .enum(["debugging", "conventions", "architecture", "build-commands", "preferences", "insights"])
      .optional()
      .describe("Memory topic (for action=memory or action=topic)"),
    source: tool.schema
      .enum(["agent", "user-correction", "pattern-detected"])
      .optional()
      .describe("Who or what triggered this memory (default: agent)"),
  },
  async execute(args) {
    const scope = args.scope ?? "project"

    // ——— Auto-memory: agent-driven learning ————————————————

    if (args.action === "topics") {
      const topics = listMemoryTopics()
      if (!topics.length) return "No memory topic files yet. Use studio_remember action=memory to save agent learnings."
      return topics.map((t) => `- ${t.topic} (${t.lines} lines)`).join("\n")
    }

    if (args.action === "topic") {
      if (!args.topic) return "topic required (debugging, conventions, architecture, build-commands, preferences, insights)"
      const content = readMemoryTopic(args.topic)
      return content ?? `No memories in topic '${args.topic}' yet.`
    }

    if (args.action === "memory") {
      if (!args.rule?.trim()) return "rule (memory content) required for action=memory"
      if (!VALID_TOPICS.includes(args.topic!)) return "topic required and must be one of: " + VALID_TOPICS.join(", ")

      if (hasSimilarMemory(args.rule, args.topic)) {
        return `Similar memory already exists in '${args.topic}'. Skipping to avoid duplicates.`
      }

      const result = saveMemory({
        topic: args.topic!,
        content: args.rule,
        source: args.source ?? "agent",
        createdAt: new Date().toISOString(),
      })
      return result
    }

    // ——— Rule management (original functionality) ————————————————

    if (args.action === "list" || args.action === "show") {
      const project = listRules()
      const global = loadUserProfile().globalRules
      const lines: string[] = []
      if (global.length) lines.push("Global:\n" + global.map((r) => `- ${r}`).join("\n"))
      if (project.length) lines.push("Project:\n" + formatRules(project))
      lines.push("\nAuto-memory: use studio_remember action=topics to see topic files.")
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
