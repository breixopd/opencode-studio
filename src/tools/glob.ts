import * as log from "../core/logger"
import { Glob } from "bun"
import { statSync } from "fs"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { DEFAULT_EXCLUDES } from "../config/defaults"
import { isRelativePathExcluded } from "../sync/excludes"
import { getActiveDirectory } from "../core/active-dir"

export interface GlobHit {
  path: string
  size?: number
}

export function globWorkspace(
  pattern: string,
  cwd = getActiveDirectory(),
  opts?: { max?: number; includeDirs?: boolean },
): GlobHit[] | { error: string } {
  const max = opts?.max ?? 200
  const hits: GlobHit[] = []

  try {
    const glob = new Glob(pattern)
    for (const entry of glob.scanSync({ cwd, dot: false, onlyFiles: !opts?.includeDirs })) {
      const rel = entry.replace(/\\/g, "/")
      if (isRelativePathExcluded(rel, DEFAULT_EXCLUDES)) continue
      try {
        const st = statSync(`${cwd}/${rel}`)
        if (!opts?.includeDirs && st.isDirectory()) continue
        hits.push({ path: rel, size: st.isFile() ? st.size : undefined })
        if (hits.length >= max) break
      } catch (err) {
      log.debugCatch("src/tools/glob.ts", err);
        /* skip missing */
      }
    }
    hits.sort((a, b) => a.path.localeCompare(b.path))
    return hits
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export const studio_glob: ToolDefinition = tool({
  description:
    "List files in THIS repo by glob (e.g. **/*.ts, src/**). Respects studio excludes. Use before studio_grep.",
  args: {
    pattern: tool.schema.string().describe("Glob pattern, e.g. **/*.{ts,tsx}"),
    max: tool.schema.number().optional().describe("Max paths (default 200)"),
    include_dirs: tool.schema.boolean().optional().describe("Include directories"),
  },
  async execute(args) {
    const result = globWorkspace(args.pattern, getActiveDirectory(), {
      max: args.max,
      includeDirs: args.include_dirs,
    })
    if ("error" in result) return result.error
    if (!result.length) return `No files for pattern: ${args.pattern}`
    return result.map((h) => (h.size != null ? `${h.path} (${h.size}b)` : h.path)).join("\n")
  },
})
