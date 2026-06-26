import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  loadConfig,
  findProjectNameForLocal,
  updateProject,
} from "../config/config"
import { ensureStudioGitignored } from "../core/gitignore"
import { setModelMode, getModelMode, type ModelMode, getPendingCatalogNotice } from "../core/project-profile"
import { clearStudioRoutedAgents, refreshModelRouting } from "../core/model-routing"

export const studio_preferences: ToolDefinition = tool({
  description:
    "Preferences: model mode, remote path, multi-remote env, .studio commit. " +
      "Global settings in ~/.config/opencode-studio/user.json.",
  args: {
    action: tool.schema
      .enum([
        "set_remote_path",
        "add_remote_env",
        "set_remote_env",
        "allow_studio_commit",
        "set_model_mode",
        "show",
      ])
      .describe("Preference action"),
    project: tool.schema
      .string()
      .optional()
      .describe("Project name (defaults to current repo mapping)"),
    remote: tool.schema
      .string()
      .optional()
      .describe("Absolute remote path for set_remote_path"),
    remote_env: tool.schema
      .string()
      .optional()
      .describe("Remote env name for add_remote_env / set_remote_env (e.g. 'staging')"),
    remote_ssh_host: tool.schema
      .string()
      .optional()
      .describe("SSH host for the remote env (add_remote_env)"),
    allow: tool.schema
      .boolean()
      .optional()
      .describe("Allow committing .studio/ when true; keep gitignored when false"),
    model_mode: tool.schema
      .enum(["free", "balanced", "quality"])
      .optional()
      .describe("Global subagent routing: free | balanced | quality"),
  },
  async execute(args) {
    const config = loadConfig()
    const cwd = process.cwd()
    const name = args.project ?? findProjectNameForLocal(config, cwd)

    if (args.action === "show") {
      const lines = [`Model mode (global): ${getModelMode()}`]
      const notice = getPendingCatalogNotice()
      if (notice) lines.push(`Catalog notice: ${notice}`)
      if (!name || !config.projects[name]) {
        lines.push("No project mapping for current directory.")
        return lines.join("\n")
      }
      const p = config.projects[name]
      lines.push(
        `Project: ${name}`,
        `Local: ${p.local}`,
        `Remote: ${p.remote}`,
        `Commit .studio/: ${p.commitStudio ? "yes" : "no (gitignored)"}`,
      )
      if (p.remotes && Object.keys(p.remotes).length > 0) {
        lines.push(`Remote envs: ${Object.entries(p.remotes).map(([k, v]) => `${k}→${v.remote}`).join(", ")}`)
      }
      return lines.join("\n")
    }

    if (args.action === "set_model_mode") {
      if (!args.model_mode) return "model_mode required (free | balanced | quality)"
      const mode = setModelMode(args.model_mode as ModelMode)
      clearStudioRoutedAgents()
      await refreshModelRouting()
      return `Model mode set to '${mode}'. Subagent routing updated.`
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

    if (args.action === "add_remote_env") {
      if (!args.remote_env?.trim()) return "remote_env required (e.g. 'staging')"
      if (!args.remote?.trim()) return "remote path required for add_remote_env"
      const project = config.projects[name]
      const remotes = { ...(project.remotes ?? {}) }
      remotes[args.remote_env.trim()] = {
        remote: args.remote.trim(),
        ssh: args.remote_ssh_host?.trim()
          ? { host: args.remote_ssh_host.trim() }
          : undefined,
      }
      updateProject(config, name, { remotes } as Partial<typeof project>)
      return `Added remote env '${args.remote_env}' for '${name}': ${args.remote.trim()}` +
        (args.remote_ssh_host ? ` (SSH host: ${args.remote_ssh_host})` : "")
    }

    if (args.action === "set_remote_env") {
      if (!args.remote_env?.trim()) return "remote_env required (e.g. 'staging')"
      const project = config.projects[name]
      const remotes = project.remotes ?? {}
      const env = remotes[args.remote_env.trim()]
      if (!env) {
        const available = Object.keys(remotes).join(", ") || "(none — add with add_remote_env first)"
        return `Remote env '${args.remote_env}' not found. Available: ${available}`
      }
      // Switch the active remote path to the selected env.
      updateProject(config, name, { remote: env.remote })
      return `Active remote env switched to '${args.remote_env}' for '${name}': ${env.remote}`
    }

    return "Unknown action"
  },
})
