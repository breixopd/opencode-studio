import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  openBranch,
  foldBranch,
  listBranches,
  getActiveBranch,
} from "../core/workspace"

export const studio_branch: ToolDefinition = tool({
  description:
    "Context folding: open a sub-goal branch for focused work, then fold it with a summary when done. Folded summaries stay in workspace memory.",
  args: {
    action: tool.schema.enum(["open", "fold", "list", "current"]).describe("Branch action"),
    title: tool.schema.string().optional().describe("Branch title (open)"),
    goal: tool.schema.string().optional().describe("Branch goal (open)"),
    id: tool.schema.string().optional().describe("Branch id (fold)"),
    summary: tool.schema.string().optional().describe("Fold summary — key findings and changes"),
  },
  async execute(args) {
    if (args.action === "list") {
      const branches = listBranches()
      if (!branches.length) return "No branches."
      return branches
        .map((b) => `${b.id} [${b.status}] ${b.title}${b.summary ? ` — ${b.summary.slice(0, 80)}` : ""}`)
        .join("\n")
    }

    if (args.action === "current") {
      const b = getActiveBranch()
      return b ? JSON.stringify(b, null, 2) : "No active branch (main thread)."
    }

    if (args.action === "open") {
      if (!args.title || !args.goal) return "title and goal required for open"
      const branch = openBranch(args.title, args.goal)
      return `Branch opened: ${branch.id}\n${branch.title}\n${branch.goal}`
    }

    if (args.action === "fold") {
      const branchId = args.id ?? getActiveBranch()?.id
      if (!branchId) return "id required (or open a branch first)"
      if (!args.summary?.trim()) return "summary required for fold"
      const branch = foldBranch(branchId, args.summary.trim())
      return `Branch folded: ${branch.id}\nSummary preserved in workspace memory.`
    }

    return "Unknown action"
  },
})
