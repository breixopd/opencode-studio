import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  buildCodeIndex,
  listSymbolsInFile,
  outlineFile,
  searchSymbols,
  type SymbolKind,
} from "../core/code-index"

export const studio_symbols: ToolDefinition = tool({
  description:
    "AST symbol index via tree-sitter (30+ languages). Cached in .studio/code-index.db.",
  args: {
    action: tool.schema
      .enum(["search", "file", "outline", "stats", "rebuild"])
      .describe("search | file | outline (AST tree) | stats | rebuild"),
    query: tool.schema.string().optional().describe("Search query (search action)"),
    file: tool.schema.string().optional().describe("Relative file path (file/outline)"),
    kind: tool.schema
      .enum(["function", "class", "interface", "type", "const", "method", "module"])
      .optional()
      .describe("Filter by symbol kind"),
    max: tool.schema.number().optional().describe("Max results (default 40)"),
  },
  async execute(args) {
    const root = process.cwd()

    if (args.action === "rebuild") {
      const index = await buildCodeIndex(root, true)
      return `Rebuilt code index (${index.parser}): ${index.symbolCount} symbols, ${index.chunkCount} chunks, ${index.edgeCount} edges from ${index.fileCount} files.`
    }

    if (args.action === "stats") {
      const index = await buildCodeIndex(root)
      return JSON.stringify(
        {
          parser: index.parser,
          builtAt: index.builtAt,
          fileCount: index.fileCount,
          symbolCount: index.symbolCount,
          chunkCount: index.chunkCount,
          edgeCount: index.edgeCount,
          importCount: index.importCount,
          cache: ".studio/code-index.db",
        },
        null,
        2,
      )
    }

    if (args.action === "outline") {
      if (!args.file) return "file required for outline action"
      try {
        return await outlineFile(args.file, root)
      } catch (err) {
        return `Outline failed: ${(err as Error).message}`
      }
    }

    if (args.action === "file") {
      if (!args.file) return "file required for file action"
      const syms = await listSymbolsInFile(args.file, root)
      if (!syms.length) return `No symbols indexed for ${args.file}`
      return syms.map((s) => `${s.kind} ${s.name} — ${s.file}:${s.line}`).join("\n")
    }

    if (!args.query?.trim()) return "query required for search action"
    const hits = await searchSymbols(args.query, root, {
      kind: args.kind as SymbolKind | undefined,
      max: args.max,
    })
    if (!hits.length) return `No symbols matching: ${args.query}`
    return hits.map((s) => `${s.kind} ${s.name} — ${s.file}:${s.line}`).join("\n")
  },
})
