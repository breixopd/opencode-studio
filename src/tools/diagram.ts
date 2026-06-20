import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { writeFileSync } from "fs"
import { studioPath, ensureStudioDirs } from "../core/studio-dir"

export const studio_diagram: ToolDefinition = tool({
  description: "Save a mermaid diagram to .studio/diagrams/ for plans and architecture.",
  args: {
    name: tool.schema.string().describe("Diagram name (filename without extension)"),
    mermaid: tool.schema.string().describe("Mermaid diagram source"),
  },
  async execute(args) {
    ensureStudioDirs()
    const path = studioPath("diagrams", `${args.name}.mmd`)
    writeFileSync(path, args.mermaid, "utf-8")
    return `Diagram saved: ${path}\n\n\`\`\`mermaid\n${args.mermaid}\n\`\`\``
  },
})
