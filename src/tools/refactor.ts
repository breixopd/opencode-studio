import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { findReferences, searchSymbols, findImpactAnalysis } from "../core/code-index"
import { listSymbolsInFile } from "../core/code-index"

/**
 * studio_refactor — code refactoring using the existing symbol graph.
 *
 * Leverages findReferences/findImpact to show exactly what a rename or extract
 * would touch before the agent makes changes. Read-only — it plans, the agent
 * executes with its usual edit tools.
 *
 * Actions:
 *   rename — find all references to a symbol for a safe rename
 *   extract — show what to extract and its dependencies
 *   callers — who calls this function (transitive)
 *   dead_code — find exported symbols with no callers
 *   structure — analyze file/module structure for improvement suggestions
 */
export const studio_refactor: ToolDefinition = tool({
  description:
    "Refactor planning using the symbol graph: find all refs for a safe rename, " +
      "extract analysis, dead-code detection, structure suggestions. Read-only — plans the change, agent executes.",
  args: {
    action: tool.schema
      .enum(["rename", "extract", "callers", "dead_code", "structure"])
      .describe("rename=all refs to symbol | extract=deps of a function | callers=transitive | dead_code=uncalled exports | structure=file analysis"),
    symbol: tool.schema
      .string()
      .optional()
      .describe("Symbol name (required for rename, extract, callers)"),
    file: tool.schema
      .string()
      .optional()
      .describe("File path (for extract, structure)"),
    max: tool.schema.number().optional().describe("Max results (default 30)"),
  },
  async execute(args) {
    const root = process.cwd()
    const max = args.max ?? 30

    switch (args.action) {
      case "rename": {
        if (!args.symbol) return "symbol required for rename"
        const refs = findReferences(args.symbol, root, max)
        const impacts = findImpactAnalysis(args.symbol, root, 3, max)
        const directCount = refs.length
        const transitiveCount = impacts.length

        const lines = [
          `# Rename analysis: ${args.symbol}`,
          ``,
          `Direct references: ${directCount}`,
          `Transitive callers (depth 3): ${transitiveCount}`,
          ``,
        ]

        if (directCount > 0) {
          lines.push("## Files to update (direct refs)")
          const byFile = new Map<string, number>()
          for (const r of refs) {
            byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1)
          }
          for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
            lines.push(`- ${file} (${count} ref${count > 1 ? "s" : ""})`)
          }

          lines.push(
            "",
            `Rename ${args.symbol} in ${byFile.size} file(s). Run studio_verify after.`,
          )
        } else {
          lines.push("", "No references found. Safe to rename with no impact.")
        }

        return lines.join("\n")
      }

      case "extract": {
        if (!args.symbol) return "symbol required for extract"
        if (!args.file) return "file required for extract"
        const fileSymbols = await listSymbolsInFile(args.file, root)
        const target = fileSymbols.find((s) => s.name === args.symbol)
        if (!target) return `Symbol '${args.symbol}' not found in ${args.file}`

        const refs = findReferences(args.symbol, root, max)
        const lines = [
          `# Extract analysis: ${args.symbol}`,
          ``,
          `Source: ${args.file}:${target.line}-${target.endLine}`,
          `Kind: ${target.kind}`,
          `References: ${refs.length}`,
          ``,
        ]

        const byFile = new Set(refs.map((r) => r.file))
        if (refs.length > 0) {
          lines.push("## Callers (will need updated imports)")
          for (const f of byFile) {
            lines.push(`- ${f}`)
          }
        }

        lines.push(
          "",
          refs.length === 0
            ? "No external references — safe to extract/move."
            : `Update imports in ${byFile.size} file(s) after extraction.`,
        )

        return lines.join("\n")
      }

      case "callers": {
        if (!args.symbol) return "symbol required for callers"
        const impacts = findImpactAnalysis(args.symbol, root, 3, max)
        if (!impacts.length) return `No transitive callers found for: ${args.symbol}`

        const lines = [`# Transitive callers of ${args.symbol}`, ""]
        const byDepth = new Map<number, typeof impacts>()
        for (const i of impacts) {
          if (!byDepth.has(i.depth)) byDepth.set(i.depth, [])
          byDepth.get(i.depth)!.push(i)
        }
        for (const [depth, items] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
          lines.push(`## Depth ${depth}`)
          for (const i of items) {
            lines.push(`- ${i.name} (${i.kind}) — ${i.file}:${i.lineStart} [${i.callerCount} callers]`)
          }
        }

        return lines.join("\n")
      }

      case "dead_code": {
        // Find exported symbols that have zero incoming references.
        const allSymbols = await searchSymbols("", root, { max: 200 })
        const exported = allSymbols.filter((s) => s.kind === "function" || s.kind === "class" || s.kind === "interface")

        const dead: Array<{ name: string; kind: string; file: string; line: number }> = []
        let checked = 0
        for (const s of exported) {
          if (checked >= max) break
          checked++
          const refs = findReferences(s.name, root, 5)
          if (refs.length === 0) {
            dead.push({ name: s.name, kind: s.kind, file: s.file, line: s.line })
          }
        }

        if (!dead.length) return `No dead code found (checked ${checked} exported symbols).`

        const lines = [`# Potential dead code (no references found)`, "", `Checked ${checked} symbols, found ${dead.length} unreferenced:`, ""]
        for (const d of dead) {
          lines.push(`- ${d.kind} ${d.name} — ${d.file}:${d.line}`)
        }
        lines.push("", "Verify with grep before deleting — dynamic references may exist.")

        return lines.join("\n")
      }

      case "structure": {
        if (!args.file) return "file required for structure analysis"
        const symbols = await listSymbolsInFile(args.file, root)
        if (!symbols.length) return `No symbols found in ${args.file}`

        const lines = [`# Structure analysis: ${args.file}`, ""]
        lines.push(`Symbols: ${symbols.length}`)
        lines.push(`  Functions: ${symbols.filter((s) => s.kind === "function").length}`)
        lines.push(`  Methods: ${symbols.filter((s) => s.kind === "method").length}`)
        lines.push(`  Classes: ${symbols.filter((s) => s.kind === "class").length}`)
        lines.push(`  Interfaces: ${symbols.filter((s) => s.kind === "interface").length}`)

        // Find the longest function (potential refactoring candidate).
        const functions = symbols.filter((s) => s.kind === "function" || s.kind === "method")
        if (functions.length > 0) {
          const longest = functions
            .map((f) => ({
              name: f.name,
              file: f.file,
              line: f.line,
              span: (f.endLine ?? f.line) - f.line,
            }))
            .sort((a, b) => b.span - a.span)

          const longFns = longest.filter((f) => f.span > 30)
          if (longFns.length > 0) {
            lines.push("", "## Long functions (>30 lines — extract candidates)")
            for (const f of longFns.slice(0, 5)) {
              lines.push(`- ${f.name} — ${f.span} lines (${f.file}:${f.line})`)
            }
          }
        }

        return lines.join("\n")
      }

      default:
        return `Unknown action: ${args.action}`
    }
  },
})
