import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { searchMemory, listHandoffs, listRules } from "../core/workspace"

export const studio_memory: ToolDefinition = tool({
  description:
    "Search project memory: plans, handoffs, folded branches. For rules use studio_remember list.",
  args: {
    action: tool.schema.enum(["search", "handoffs", "rules"]).describe("Memory action"),
    query: tool.schema.string().optional().describe("Search query"),
  },
  async execute(args) {
    if (args.action === "rules") {
      const rules = listRules()
      return rules.length
        ? rules.map((r) => `- ${r}`).join("\n")
        : "No rules. Use studio_remember add."
    }

    if (args.action === "handoffs") {
      const hs = listHandoffs()
      return hs.length ? hs.map((h) => `- ${h.id}: ${h.summary.slice(0, 120)}`).join("\n") : "No handoffs."
    }

    if (!args.query?.trim()) return "query required for search"
    const hits = searchMemory(args.query.trim())
    if (!hits.length) return `No hits for: ${args.query}`
    return hits.map((h) => `[${h.kind}] ${h.title}\n${h.snippet}`).join("\n\n")
  },
})
