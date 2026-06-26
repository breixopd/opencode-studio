import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { safeFetch } from "../core/web-fetch"
import { extractFromHtml, formatForLlm } from "../core/web-extract"

export const studio_fetch: ToolDefinition = tool({
  description:
    "Fetch URL with readability extraction (markdown/llm text). SSRF-safe, browser-like headers.",
  args: {
    url: tool.schema.string().url().describe("URL to fetch"),
    format: tool.schema
      .enum(["text", "markdown", "llm"])
      .optional()
      .describe("Output format (default llm)"),
    only_main_content: tool.schema
      .boolean()
      .optional()
      .describe("Strip nav/ads via readability (default true)"),
    max_chars: tool.schema.number().optional().describe("Max characters (default 12000)"),
  },
  async execute(args) {
    const max = args.max_chars ?? 12_000
    const format = args.format ?? "llm"
    try {
      const res = await safeFetch(args.url)
      if (!res.status.toString().startsWith("2")) {
        return `HTTP ${res.status} for ${args.url}`
      }

      if (res.contentType.includes("application/json")) {
        const body = res.body.slice(0, max)
        return body.length >= max ? `${body}\n\n[truncated]` : body
      }

      if (!res.contentType.includes("html")) {
        const body = res.body.slice(0, max)
        return body.length >= max ? `${body}\n\n[truncated]` : body
      }

      const page = await extractFromHtml(res.body, res.finalUrl, {
        onlyMainContent: args.only_main_content !== false,
      })
      return formatForLlm(page, format, max)
    } catch (err) {
      return `Fetch failed: ${(err as Error).message}`
    }
  },
})
