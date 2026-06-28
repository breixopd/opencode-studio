import * as log from "../core/logger"
import { execFileSync } from "child_process"
import { existsSync } from "fs"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { isExcluded, isRelativePathExcluded } from "../sync/excludes"
import { DEFAULT_EXCLUDES } from "../config/defaults"

export interface GrepHit {
  file: string
  line: number
  text: string
}

// Memoized ripgrep check — previously spawned `rg --version` on EVERY grep call.
let rgCache: boolean | null = null

function hasRipgrep(): boolean {
  if (rgCache !== null) return rgCache
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" })
    rgCache = true
  } catch (err) {
      log.debugCatch("src/tools/grep.ts", err);
    /* ripgrep not installed — fall back to JS grep */
    rgCache = false
  }
  return rgCache
}

/** Search this repo with ripgrep — no index build, respects default excludes. */
export function grepWorkspace(
  pattern: string,
  cwd = process.cwd(),
  opts?: { glob?: string; max?: number; ignoreCase?: boolean },
): GrepHit[] | { error: string } {
  if (!hasRipgrep()) {
    return { error: "ripgrep (rg) not installed — use OpenCode read/bash or install rg." }
  }

  const max = opts?.max ?? 40
  const args = [
    "--no-heading",
    "--line-number",
    "--max-count",
    String(max),
    "--color=never",
  ]
  if (opts?.ignoreCase) args.push("-i")
  if (opts?.glob) args.push("--glob", opts.glob)
  for (const ex of DEFAULT_EXCLUDES) {
    if (ex.endsWith("/")) args.push("--glob", `!${ex}**`)
    else if (ex.includes("*")) args.push("--glob", `!${ex}`)
  }
  args.push(pattern, ".")

  try {
    const out = execFileSync("rg", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    })
    return parseRipgrepOutput(out, cwd)
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: Buffer; message?: string }
    if (e.status === 1) return []
    return { error: e.stderr?.toString() || e.message || "rg failed" }
  }
}

function parseRipgrepOutput(out: string, cwd: string): GrepHit[] {
  const hits: GrepHit[] = []
  for (const line of out.split("\n")) {
    if (!line.trim()) continue
    const m = line.match(/^(.+?):(\d+):(.*)$/)
    if (!m) continue
    const rel = m[1]
    if (isExcluded(rel, cwd, DEFAULT_EXCLUDES) || isRelativePathExcluded(rel, DEFAULT_EXCLUDES)) {
      continue
    }
    if (!existsSync(rel.startsWith("/") ? rel : `${cwd}/${rel}`)) continue
    hits.push({ file: rel, line: Number(m[2]), text: m[3].trim() })
  }
  return hits
}

export const studio_grep: ToolDefinition = tool({
  description:
    "Search THIS repo with ripgrep (instant, no index). Use for local code exploration before studio_code_search (GitHub).",
  args: {
    pattern: tool.schema.string().describe("Search pattern (regex or literal)"),
    glob: tool.schema.string().optional().describe("File glob, e.g. *.ts"),
    max: tool.schema.number().optional().describe("Max matches (default 40)"),
    ignore_case: tool.schema.boolean().optional().describe("Case insensitive"),
  },
  async execute(args) {
    const result = grepWorkspace(args.pattern, process.cwd(), {
      glob: args.glob,
      max: args.max,
      ignoreCase: args.ignore_case,
    })
    if ("error" in result) return result.error
    if (!result.length) return `No matches for: ${args.pattern}`
    return result
      .map((h) => `${h.file}:${h.line}: ${h.text}`)
      .join("\n")
      .slice(0, 24_000)
  },
})
