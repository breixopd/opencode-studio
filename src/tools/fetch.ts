import { tool, type ToolDefinition } from "@opencode-ai/plugin"

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export const studio_fetch: ToolDefinition = tool({
  description: "Fetch URL content as plain text (no API key). Native alternative to webfetch MCP.",
  args: {
    url: tool.schema.string().url().describe("URL to fetch"),
    max_chars: tool.schema.number().optional().describe("Max characters (default 12000)"),
  },
  async execute(args) {
    const max = args.max_chars ?? 12_000
    try {
      const res = await fetch(args.url, {
        headers: { "User-Agent": "opencode-studio/1.0" },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return `HTTP ${res.status} for ${args.url}`
      const html = await res.text()
      const text = stripHtml(html).slice(0, max)
      return text.length >= max ? `${text}\n\n[truncated]` : text
    } catch (err) {
      return `Fetch failed: ${(err as Error).message}`
    }
  },
})
