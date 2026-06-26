import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  formatSearchResults,
  scrapeSearchResults,
  searchWeb,
} from "../core/web-search"

export { searchDuckDuckGo } from "../core/web-search"

export const studio_search: ToolDefinition = tool({
  description:
    "Search the web. Default: DuckDuckGo (no API key). Optional: TAVILY_API_KEY. Use scrape:true to fetch top hits.",
  args: {
    query: tool.schema.string().describe("Search query"),
    count: tool.schema.number().optional().describe("Max results (default 8)"),
    scrape: tool.schema
      .boolean()
      .optional()
      .describe("Fetch and extract top results (default false)"),
    scrape_top: tool.schema
      .number()
      .optional()
      .describe("How many top hits to scrape when scrape=true (default 3, max 5)"),
  },
  async execute(args) {
    try {
      const count = args.count ?? 8
      const { backend, results } = await searchWeb(args.query, count)
      if (!results.length) return `No results for: ${args.query}`

      const final = args.scrape
        ? await scrapeSearchResults(results, args.scrape_top ?? 3)
        : results

      return formatSearchResults(final, backend)
    } catch (err) {
      return `Search failed: ${(err as Error).message}`
    }
  },
})
