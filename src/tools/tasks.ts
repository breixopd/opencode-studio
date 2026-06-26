import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  createTask,
  updateTask,
  listTasks,
  incompleteTasks,
  setActiveTasks,
  getActiveTasks,
  getWorkflowState,
} from "../core/workspace"

export const studio_task: ToolDefinition = tool({
  description:
    "Manage work tasks. Actions: list, create, start, done, block, current, incomplete. Finish all tasks before stopping.",
  args: {
    action: tool.schema
      .enum(["list", "create", "start", "done", "block", "current", "incomplete"])
      .describe("Task action"),
    title: tool.schema.string().optional().describe("Title for create"),
    id: tool.schema.string().optional().describe("Task id for start/done/block"),
    acceptance: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Acceptance criteria for create"),
    notes: tool.schema.string().optional().describe("Notes for block/done"),
  },
  async execute(args) {
    switch (args.action) {
      case "list": {
        const tasks = listTasks()
        if (tasks.length === 0) return "No tasks. Use action=create to add work items."
        return JSON.stringify(tasks, null, 2)
      }
      case "incomplete": {
        const open = incompleteTasks()
        return open.length === 0 ? "All tasks complete." : JSON.stringify(open, null, 2)
      }
      case "current": {
        const workflow = getWorkflowState()
        const active = getActiveTasks()
        return active.length === 0
          ? "No active tasks."
          : JSON.stringify({ workflow, tasks: active }, null, 2)
      }
      case "create": {
        if (!args.title) return "title required for create"
        const task = createTask(args.title, args.acceptance)
        setActiveTasks([...getWorkflowState().activeTaskIds, task.id])
        return JSON.stringify(task, null, 2)
      }
      case "start": {
        if (!args.id) return "id required"
        return JSON.stringify(updateTask(args.id, { status: "in_progress" }), null, 2)
      }
      case "done": {
        if (!args.id) return "id required"
        const t = updateTask(args.id, { status: "done", notes: args.notes })
        const workflow = getWorkflowState()
        setActiveTasks(workflow.activeTaskIds.filter((x) => x !== args.id))
        const remaining = incompleteTasks()
        return JSON.stringify(
          {
            task: t,
            remaining: remaining.length,
            message: remaining.length ? "More tasks remain." : "All tasks complete.",
          },
          null,
          2,
        )
      }
      case "block": {
        if (!args.id) return "id required"
        return JSON.stringify(updateTask(args.id, { status: "blocked", notes: args.notes }), null, 2)
      }
      default:
        return "Unknown action"
    }
  },
})
