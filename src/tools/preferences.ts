import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  loadConfig,
  saveConfig,
  findProjectNameForLocal,
  updateProject,
} from "../config/config"
import { ensureStudioGitignored } from "../core/gitignore"
import {
  setModelMode,
  getModelMode,
  type ModelMode,
  getPendingCatalogNotice,
  setAutonomyMode,
  getAutonomyMode,
  type AutonomyMode,
  setPreferLocalModels,
  getPreferLocalModels,
  setSemanticRecall,
  getSemanticRecall,
  setSessionBudgetUsd,
  getSessionBudgetUsd,
  hasExplicitBudget,
} from "../core/project-profile"
import { getSemanticRecallStatus } from "../core/semantic-recall"
import { clearStudioRoutedAgents, refreshModelRouting } from "../core/model-routing"
import { invalidateScoutCache } from "../core/scout"
import { getActiveDirectory } from "../core/active-dir"

function parseCsvList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export const studio_preferences: ToolDefinition = tool({
  description:
    "Preferences: model mode, autonomy, local models, semantic recall, session budget, remote path, " +
      "multi-remote env, remote exec allowlists, .studio commit. " +
      "Global settings in ~/.config/opencode-studio/user.json.",
  args: {
    action: tool.schema
      .enum([
        "set_remote_path",
        "add_remote_env",
        "set_remote_env",
        "set_remote_policy",
        "allow_studio_commit",
        "set_model_mode",
        "set_autonomy",
        "set_prefer_local",
        "set_semantic_recall",
        "set_session_budget",
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
    allowed_hosts: tool.schema
      .string()
      .optional()
      .describe("Comma-separated SSH aliases for studio_remote (set_remote_policy). Empty clears."),
    allowed_command_prefixes: tool.schema
      .string()
      .optional()
      .describe("Comma-separated command prefixes for studio_remote (set_remote_policy). Empty clears."),
    allow: tool.schema
      .boolean()
      .optional()
      .describe("Allow committing .studio/ when true; keep gitignored when false"),
    model_mode: tool.schema
      .enum(["free", "balanced", "quality"])
      .optional()
      .describe("Global subagent routing: free | balanced | quality"),
    autonomy: tool.schema
      .enum(["full", "suggest", "off"])
      .optional()
      .describe("Autonomous scout: full=act when idle | suggest=surface only (default) | off=disabled"),
    prefer_local: tool.schema
      .boolean()
      .optional()
      .describe("Prefer Ollama/LM Studio/local providers for fast/read-only subagents"),
    semantic_recall: tool.schema
      .boolean()
      .optional()
      .describe("Enable optional semantic recall (sqlite-vec or FTS token-overlap fallback)"),
    budget_usd: tool.schema
      .number()
      .optional()
      .describe("Session spend cap in USD (default $5 if never set; 0 clears → unlimited). Blocks tools when exceeded."),
  },
  async execute(args) {
    const config = loadConfig()
    const cwd = getActiveDirectory()
    const name = args.project ?? findProjectNameForLocal(config, cwd)

    if (args.action === "show") {
      const budget = getSessionBudgetUsd()
      const recallStatus = getSemanticRecallStatus(cwd)
      const lines = [
        `Model mode (global): ${getModelMode()}`,
        `Autonomy: ${getAutonomyMode()}`,
        `Prefer local models: ${getPreferLocalModels() ? "yes" : "no"}`,
        `Semantic recall: ${getSemanticRecall() ? `on (${recallStatus})` : "off"}`,
        `Session budget: ${
          budget == null
            ? "unlimited"
            : `$${budget.toFixed(2)}${hasExplicitBudget() ? "" : " (default)"}`
        }`,
      ]
      const remotePolicy = config.remote
      lines.push(
        `Remote allowedHosts: ${
          remotePolicy?.allowedHosts?.length ? remotePolicy.allowedHosts.join(", ") : "(unrestricted)"
        }`,
        `Remote allowedCommandPrefixes: ${
          remotePolicy?.allowedCommandPrefixes?.length
            ? remotePolicy.allowedCommandPrefixes.map((p) => JSON.stringify(p)).join(", ")
            : "(unrestricted)"
        }`,
      )
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

    if (args.action === "set_autonomy") {
      if (!args.autonomy) return "autonomy required (full | suggest | off)"
      const mode = setAutonomyMode(args.autonomy as AutonomyMode)
      invalidateScoutCache()
      return `Autonomy set to '${mode}'. ` +
        (mode === "off"
          ? "Scout injection disabled."
          : mode === "full"
            ? "Agents will proactively polish when idle (tests+verify first)."
            : "Agents will surface improvements without acting unless high-severity or asked.")
    }

    if (args.action === "set_prefer_local") {
      if (args.prefer_local === undefined) return "prefer_local (boolean) required"
      const prefer = setPreferLocalModels(args.prefer_local)
      clearStudioRoutedAgents()
      await refreshModelRouting()
      return `Prefer local models: ${prefer ? "yes" : "no"}. ` +
        "Routes fast/read-only subagents to Ollama/LM Studio/local when connected, " +
        "picking from models you have loaded (no hardcoded model list)."
    }

    if (args.action === "set_semantic_recall") {
      if (args.semantic_recall === undefined) return "semantic_recall (boolean) required"
      const on = setSemanticRecall(args.semantic_recall)
      const status = getSemanticRecallStatus(cwd)
      return on
        ? `Semantic recall enabled (backend: ${status}). Use studio_index action=similar. ` +
          "sqlite-vec loads if available; otherwise enhanced FTS token-overlap fallback."
        : "Semantic recall disabled (default)."
    }

    if (args.action === "set_session_budget") {
      const usd = args.budget_usd ?? 0
      const set = setSessionBudgetUsd(usd)
      return set == null
        ? "Session budget cleared (unlimited)."
        : `Session budget set to $${set.toFixed(2)}. Non-allowlisted tools block when exceeded.`
    }

    if (args.action === "set_remote_policy") {
      if (args.allowed_hosts === undefined && args.allowed_command_prefixes === undefined) {
        return "Pass allowed_hosts and/or allowed_command_prefixes (comma-separated; empty string clears)."
      }
      const next = { ...(config.remote ?? {}) }
      if (args.allowed_hosts !== undefined) {
        const hosts = parseCsvList(args.allowed_hosts) ?? []
        next.allowedHosts = hosts.length ? hosts : undefined
      }
      if (args.allowed_command_prefixes !== undefined) {
        const prefixes = parseCsvList(args.allowed_command_prefixes) ?? []
        next.allowedCommandPrefixes = prefixes.length ? prefixes : undefined
      }
      const hasPolicy =
        (next.allowedHosts?.length ?? 0) > 0 || (next.allowedCommandPrefixes?.length ?? 0) > 0
      config.remote = hasPolicy ? next : undefined
      saveConfig(config)
      return (
        `Remote policy saved.\n` +
        `allowedHosts: ${config.remote?.allowedHosts?.join(", ") ?? "(none)"}\n` +
        `allowedCommandPrefixes: ${
          config.remote?.allowedCommandPrefixes?.map((p) => JSON.stringify(p)).join(", ") ?? "(none)"
        }`
      )
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
      updateProject(config, name, { remote: env.remote })
      return `Active remote env switched to '${args.remote_env}' for '${name}': ${env.remote}`
    }

    return "Unknown action"
  },
})
