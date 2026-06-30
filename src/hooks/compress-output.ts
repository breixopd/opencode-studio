import { compressToolOutput } from "../core/compress"


export function createCompressOutputHook() {
  return async (
    input: { tool: string },
    output: { output: string },
  ) => {
    if (input.tool.startsWith("studio_")) return
    const result = await compressToolOutput(output.output)
    if (result.cached) output.output = result.text
  }
}
