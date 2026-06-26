import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  loadProjectProfile,
  updateProjectBrief,
  recordMilestone,
  touchProjectProfile,
} from "../core/project-profile"

export const studio_brief: ToolDefinition = tool({
  description:
    "Project brief — cross-session memory about what this repo is, stack, conventions, and milestones. Persists in ~/.config/opencode-studio/projects/ and injects every session.",
  args: {
    action: tool.schema.enum(["show", "update", "milestone", "refresh"]).describe("Brief action"),
    summary: tool.schema.string().optional().describe("What this project is (update)"),
    conventions: tool.schema.array(tool.schema.string()).optional().describe("Team conventions"),
    stack: tool.schema.array(tool.schema.string()).optional().describe("Tech stack override"),
    milestone: tool.schema.string().optional().describe("Completed milestone text"),
  },
  async execute(args) {
    if (args.action === "refresh") {
      const p = touchProjectProfile()
      return `Profile refreshed: ${p.name} (${p.id})`
    }

    if (args.action === "show") {
      const p = loadProjectProfile()
      return [
        `Name: ${p.name}`,
        `Path: ${p.rootPath}`,
        `Summary: ${p.summary || "(not set — use update)"}`,
        `Stack: ${p.stack.join(", ") || "unknown"}`,
        `Conventions: ${p.conventions.length ? p.conventions.join("; ") : "none"}`,
        `Completed (${p.completed.length}):`,
        ...p.completed.slice(-8).map((c) => `  - ${c}`),
        `Open concerns:`,
        ...p.openConcerns.slice(-5).map((c) => `  - ${c}`),
        p.lastHandoff ? `Last handoff: ${p.lastHandoff}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    }

    if (args.action === "milestone") {
      if (!args.milestone?.trim()) return "milestone text required"
      const p = recordMilestone(args.milestone)
      return `Recorded. ${p.completed.length} milestone(s) on file.`
    }

    if (args.action === "update") {
      if (!args.summary && !args.conventions && !args.stack) {
        return "Provide summary, conventions, and/or stack for update"
      }
      const p = updateProjectBrief({
        summary: args.summary,
        conventions: args.conventions,
        stack: args.stack,
      })
      return `Brief updated for ${p.name}`
    }

    return "Unknown action"
  },
})
