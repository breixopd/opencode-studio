import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { searchDuckDuckGo } from "./search"

export const studio_search: ToolDefinition = tool({
  description:
    "Search the web via DuckDuckGo (no API key). Use for docs, errors, and current information.",
  args: {
    query: tool.schema.string().describe("Search query"),
    count: tool.schema.number().optional().describe("Max results (default 8)"),
  },
  async execute(args) {
    try {
      const results = await searchDuckDuckGo(args.query, args.count ?? 8)
      if (results.length === 0) {
        return `No results for: ${args.query}`
      }
      return results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n")
    } catch (err) {
      return `Search failed: ${(err as Error).message}`
    }
  },
})
