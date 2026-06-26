import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  openBranch,
  foldBranch,
  listBranches,
  getActiveBranch,
} from "../core/workspace"
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  mergeWorktree,
} from "../core/worktree"

export const studio_branch: ToolDefinition = tool({
  description:
    "Context folding + git worktree isolation: open/fold sub-goal branches for focused work. " +
      "worktree_create/merge/remove for parallel agent isolation (real git worktrees in .studio/worktrees/).",
  args: {
    action: tool.schema
      .enum(["open", "fold", "list", "current", "worktree_create", "worktree_merge", "worktree_remove", "worktree_list"])
      .describe("open/fold/list/current = context branches | worktree_* = real git worktree isolation"),
    title: tool.schema.string().optional().describe("Branch title (open) or worktree name (worktree_create)"),
    goal: tool.schema.string().optional().describe("Branch goal (open)"),
    id: tool.schema.string().optional().describe("Branch id (fold) or worktree path (worktree_merge/remove)"),
    summary: tool.schema.string().optional().describe("Fold summary — key findings and changes"),
    base_branch: tool.schema.string().optional().describe("Base branch for worktree_create (default: current HEAD)"),
  },
  async execute(args) {
    // ——— Context folding (original functionality) ————————————————

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

    // ——— Git worktree isolation ————————————————

    if (args.action === "worktree_create") {
      if (!args.title) return "title (worktree name) required for worktree_create"
      const cwd = process.cwd()
      const wt = await createWorktree(cwd, args.title, args.base_branch)
      return `Worktree created:\n  Path: ${wt.path}\n  Branch: ${wt.branch}\n  Created at: ${wt.createdAt}\n\nUse this path as the working directory for a parallel @studio-implement agent.`
    }

    if (args.action === "worktree_list") {
      const cwd = process.cwd()
      const wts = await listWorktrees(cwd)
      if (!wts.length) return "No studio worktrees."
      return wts.map((w) => `${w.branch} — ${w.path}`).join("\n")
    }

    if (args.action === "worktree_merge") {
      const cwd = process.cwd()
      const wts = await listWorktrees(cwd)
      const target = wts.find((w) => args.id && (w.branch === args.id || w.path.includes(args.id)))
      if (!target) return `Worktree not found: ${args.id}. Run worktree_list to see available worktrees.`
      const result = await mergeWorktree(cwd, target)
      return result
    }

    if (args.action === "worktree_remove") {
      const cwd = process.cwd()
      const wts = await listWorktrees(cwd)
      const target = wts.find((w) => args.id && (w.branch === args.id || w.path.includes(args.id)))
      if (!target) return `Worktree not found: ${args.id}. Run worktree_list to see available worktrees.`
      await removeWorktree(cwd, target)
      return `Worktree removed: ${target.path} (branch ${target.branch} deleted).`
    }

    return "Unknown action"
  },
})
