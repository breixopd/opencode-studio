import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { loadConfig, addProject, removeProject } from "../config/config"

export const studio_add_project: ToolDefinition = tool({
  description:
    "Configure a local project directory for remote sync. The project will appear in studio_list_projects.",
  args: {
    name: tool.schema.string().describe("Short name for the project (e.g. 'myapp')"),
    local: tool.schema.string().describe("Absolute path to the local project directory"),
    remote: tool.schema.string().describe("Absolute path on the remote host to sync to"),
    excludes: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Glob patterns to exclude from sync (defaults to system default excludes)"),
  },
  async execute(args) {
    const config = loadConfig()

    try {
      addProject(config, args.name, args.local, args.remote, args.excludes)
    } catch (err) {
      return `Error adding project: ${(err as Error).message}`
    }

    return `Project '${args.name}' added: ${args.local} → ${config.ssh.host}:${args.remote}`
  },
})

export const studio_remove_project: ToolDefinition = tool({
  description: "Remove a project configuration. Does not delete any files.",
  args: {
    name: tool.schema.string().describe("Project name to remove"),
  },
  async execute(args) {
    const config = loadConfig()

    try {
      removeProject(config, args.name)
    } catch (err) {
      return `Error removing project: ${(err as Error).message}`
    }

    return `Project '${args.name}' removed.`
  },
})
