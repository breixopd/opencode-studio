import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { crawlSite } from "../core/web-crawl"

export const studio_crawl: ToolDefinition = tool({
  description:
    "Bounded same-origin crawl: follows links, extracts readable content per page (WebClaw-inspired).",
  args: {
    url: tool.schema.string().url().describe("Starting URL"),
    max_pages: tool.schema.number().optional().describe("Max pages (default 10, max 25)"),
    max_depth: tool.schema.number().optional().describe("Link depth (default 2)"),
    format: tool.schema
      .enum(["text", "markdown", "llm"])
      .optional()
      .describe("Per-page format (default llm)"),
  },
  async execute(args) {
    const result = await crawlSite(args.url, {
      maxPages: args.max_pages,
      maxDepth: args.max_depth,
      format: args.format ?? "llm",
    })
    if ("error" in result) return result.error
    if (!result.length) return `No pages crawled from ${args.url}`
    return result
      .map((p, i) => `## ${i + 1}. ${p.title}\n${p.url}\n\n${p.excerpt}`)
      .join("\n\n---\n\n")
      .slice(0, 48_000)
  },
})
