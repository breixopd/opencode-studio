import { compressToolOutput } from "../core/compress"

const SKIP = new Set(["studio_retrieve"])

export function createCompressOutputHook() {
  return async (
    input: { tool: string },
    output: { output: string },
  ) => {
    if (SKIP.has(input.tool) || input.tool.startsWith("studio_")) return
    const result = compressToolOutput(output.output)
    if (result.cached) output.output = result.text
  }
}
