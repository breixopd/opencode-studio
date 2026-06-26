import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  pinContext,
  unpinContext,
  listPinnedContext,
  clearPinnedContext,
} from "../core/workspace"

export const studio_context: ToolDefinition = tool({
  description:
    "Pin or unpin context blocks that survive compaction (Context-as-Tool). Use for critical decisions, API contracts, or failure summaries.",
  args: {
    action: tool.schema.enum(["pin", "unpin", "list", "clear"]).describe("Context action"),
    block: tool.schema.string().optional().describe("Text to pin"),
    index: tool.schema.number().optional().describe("1-based pin index for unpin"),
  },
  async execute(args) {
    if (args.action === "list") {
      const pins = listPinnedContext()
      return pins.length
        ? pins.map((p, i) => `${i + 1}. ${p}`).join("\n")
        : "No pinned context."
    }

    if (args.action === "clear") {
      clearPinnedContext()
      return "Cleared all pinned context."
    }

    if (args.action === "pin") {
      if (!args.block?.trim()) return "block required for pin"
      const pins = pinContext(args.block)
      return `Pinned (${pins.length} total). Survives compaction.`
    }

    if (args.action === "unpin") {
      if (args.index === undefined) return "index (1-based) required for unpin"
      const pins = unpinContext(args.index - 1)
      return `Unpinned. ${pins.length} remaining.`
    }

    return "Unknown action"
  },
})
