import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { retrieveCached } from "../core/compress"

export const studio_retrieve: ToolDefinition = tool({
  description: "Retrieve full tool output previously compressed by studio (from studio_retrieve id in compressed output).",
  args: {
    id: tool.schema.string().describe("Cache id from compressed output"),
  },
  async execute(args) {
    try {
      return retrieveCached(args.id)
    } catch (err) {
      return `Retrieve failed: ${(err as Error).message}`
    }
  },
})
