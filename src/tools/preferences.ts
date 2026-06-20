import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  loadConfig,
  findProjectNameForLocal,
  updateProject,
} from "../config/config"
import { ensureStudioGitignored } from "../core/gitignore"

export const studio_preferences: ToolDefinition = tool({
  description:
    "Save per-project studio preferences: remote sync path and whether .studio/ may be committed. Default remote is /home/{ssh.user}/{project-name} until you set one here.",
  args: {
    action: tool.schema
      .enum(["set_remote_path", "allow_studio_commit", "show"])
      .describe("Preference action"),
    project: tool.schema
      .string()
      .optional()
      .describe("Project name (defaults to current repo mapping)"),
    remote: tool.schema
      .string()
      .optional()
      .describe("Absolute remote path for set_remote_path"),
    allow: tool.schema
      .boolean()
      .optional()
      .describe("Allow committing .studio/ when true; keep gitignored when false"),
  },
  async execute(args) {
    const config = loadConfig()
    const cwd = process.cwd()
    const name = args.project ?? findProjectNameForLocal(config, cwd)

    if (args.action === "show") {
      if (!name || !config.projects[name]) {
        return "No project mapping for current directory. Open a git repo or pass project name."
      }
      const p = config.projects[name]
      return [
        `Project: ${name}`,
        `Local: ${p.local}`,
        `Remote: ${p.remote}`,
        `Commit .studio/: ${p.commitStudio ? "yes (user requested)" : "no (gitignored by default)"}`,
      ].join("\n")
    }

    if (!name || !config.projects[name]) {
      return "No project mapping found. Run from a configured git repo or pass project name."
    }

    if (args.action === "set_remote_path") {
      if (!args.remote?.trim()) return "remote path required for set_remote_path"
      updateProject(config, name, { remote: args.remote.trim() })
      return `Saved remote path for '${name}': ${args.remote.trim()}`
    }

    if (args.action === "allow_studio_commit") {
      if (args.allow === undefined) return "allow (boolean) required for allow_studio_commit"
      const project = config.projects[name]
      updateProject(config, name, { commitStudio: args.allow })
      const gitResult = ensureStudioGitignored(project.local, args.allow)
      const gitNote =
        gitResult === "removed"
          ? " Removed .studio/ from .gitignore."
          : gitResult === "added"
            ? " Added .studio/ to .gitignore."
            : ""
      return `Commit .studio/ for '${name}': ${args.allow ? "allowed" : "blocked (gitignored)"}.${gitNote}`
    }

    return "Unknown action"
  },
})
