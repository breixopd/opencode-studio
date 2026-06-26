import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  researchCodebase,
  searchSymbols,
  semanticCodeSearch,
  findReferences,
  findFileImporters,
  findImpactAnalysis,
  findArchitectureHotspots,
} from "../core/code-index"
import { getSessionDeduper } from "../core/dedup-session"
import { optimizeToolOutput } from "../core/token-budget"
import { grepWorkspace } from "./grep"

export const studio_index: ToolDefinition = tool({
  description:
    "Native code intelligence: tree-sitter AST + SQLite FTS5 + graph. " +
      "search=rg | semantic=BM25 | research=multi-hop | symbols=name | " +
      "refs=callers | importers=file-imports | impact=transitive | hotspots=most-referenced.",
  args: {
    action: tool.schema
      .enum(["search", "semantic", "research", "symbols", "refs", "importers", "impact", "hotspots"])
      .describe(
        "search=ripgrep | semantic=BM25 AST | research=multi-hop | symbols=name lookup | " +
          "refs=who calls symbol | importers=who imports file | impact=transitive callers | " +
          "hotspots=most-referenced symbols",
      ),
    query: tool.schema
      .string()
      .optional()
      .describe("Symbol name, file path, or search query (required for most actions; not for hotspots)"),
    path: tool.schema.string().optional().describe("Path prefix or glob filter (search/semantic only)"),
    max: tool.schema.number().optional().describe("Max results (default 15; hotspots default 20)"),
  },
  async execute(args, ctx) {
    const root = ctx?.directory ?? process.cwd()
    const deduper = getSessionDeduper(ctx?.sessionID)
    const max = args.max ?? 15

    // ——— Graph queries (Phase 2) ————————————————

    if (args.action === "hotspots") {
      const hits = findArchitectureHotspots(root, args.max ?? 20)
      if (!hits.length) return "No hotspots found. Build the index first with studio_symbols action=stats."
      const out = hits
        .map((h) => `${h.name} (${h.kind}) — ${h.file}:${h.lineStart} in=${h.inDegree} out=${h.outDegree}`)
        .join("\n")
      return optimizeToolOutput(out, deduper, { budget: 3000 })
    }

    if (args.action === "refs") {
      if (!args.query) return "query required (symbol name)"
      const refs = findReferences(args.query, root, max)
      if (!refs.length) return `No refs found for: ${args.query}`
      const out = refs
        .map(
          (r) =>
            `${r.file}${r.line ? `:${r.line}` : ""} (${r.edgeType}${r.resolved ? " ✓" : " ?"})` +
            (r.srcSymbol ? ` from ${r.srcSymbol.name}` : ""),
        )
        .join("\n")
      return optimizeToolOutput(out, deduper, { budget: 4000 })
    }

    if (args.action === "importers") {
      if (!args.query) return "query required (file path)"
      const importers = findFileImporters(args.query, root, max)
      if (!importers.length) return `No importers found for: ${args.query}`
      const out = importers
        .map((i) => `${i.importerFile}:${i.line}${i.names ? ` (imports: ${i.names})` : ""}`)
        .join("\n")
      return optimizeToolOutput(out, deduper, { budget: 4000 })
    }

    if (args.action === "impact") {
      if (!args.query) return "query required (symbol name)"
      const impacts = findImpactAnalysis(args.query, root, 3, max)
      if (!impacts.length) return `No transitive callers found for: ${args.query}`
      const out = impacts
        .map(
          (i) =>
            `${i.name} (${i.kind}) — ${i.file}:${i.lineStart} depth=${i.depth} callers=${i.callerCount}`,
        )
        .join("\n")
      return optimizeToolOutput(out, deduper, { budget: 5000 })
    }

    // ——— Search / semantic / research / symbols ————————————————

    const query = (args.query ?? "").trim()
    if (!query) return "query required"

    if (args.action === "symbols") {
      const hits = await searchSymbols(query, root, { max: max * 2 })
      if (!hits.length) return `No symbols for: ${query}`
      const out = hits.map((s) => `${s.kind} ${s.name} — ${s.file}:${s.line}`).join("\n")
      return optimizeToolOutput(out, deduper, { budget: 2000 })
    }

    if (args.action === "semantic") {
      const hits = await semanticCodeSearch(query, root, { max, pathPrefix: args.path })
      if (!hits.length) return `No semantic hits for: ${query}`
      const out = hits
        .map(
          (h) =>
            `${h.file}:${h.line}${h.symbol ? ` ${h.symbol}` : ""} (score ${h.score?.toFixed(2)})\n${h.text.slice(0, 800)}`,
        )
        .join("\n\n---\n\n")
      return optimizeToolOutput(out, deduper, { budget: 6000 })
    }

    if (args.action === "research") {
      const out = await researchCodebase(query, root, { max })
      return optimizeToolOutput(out, deduper, { budget: 8000 })
    }

    // Default: search (ripgrep with BM25 fallback)
    const grep = grepWorkspace(query, root, { glob: args.path, max: max * 2 })
    if ("error" in grep) {
      const syms = await searchSymbols(query, root, { max })
      if (syms.length) {
        return optimizeToolOutput(
          `${grep.error}\n\nSymbol matches:\n` +
            syms.map((s) => `${s.name} — ${s.file}:${s.line}`).join("\n"),
          deduper,
          { budget: 2000 },
        )
      }
      return grep.error
    }
    if (!grep.length) {
      const semantic = await semanticCodeSearch(query, root, { max, pathPrefix: args.path })
      if (semantic.length) {
        return optimizeToolOutput(
          `No rg matches. BM25 hits:\n` +
            semantic.map((h) => `${h.file}:${h.line} ${h.symbol ?? ""}`).join("\n"),
          deduper,
          { budget: 2000 },
        )
      }
      return `No matches for: ${query}`
    }
    const out = grep.map((h) => `${h.file}:${h.line}: ${h.text}`).join("\n")
    return optimizeToolOutput(out, deduper, { budget: 6000 })
  },
})
