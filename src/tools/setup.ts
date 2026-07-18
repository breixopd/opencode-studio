import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { loadConfig, saveConfig } from "../config/config"
import { parseSSHConfig } from "../config/ssh-config"
import type { StudioConfig } from "../config/types"
import { LOCAL_PROVIDERS } from "../core/model-catalog"
import { getLatestConfig, clearStudioRoutedAgents, refreshModelRouting } from "../core/model-routing"
import { detectTooling } from "../core/project-detect"
import { getActiveDirectory } from "../core/active-dir"
import {
  DEFAULT_SESSION_BUDGET_USD,
  getPreferLocalModels,
  getSessionBudgetUsd,
  hasExplicitBudget,
  setPreferLocalModels,
  setSessionBudgetUsd,
} from "../core/project-profile"

function applyHost(existing: StudioConfig, selected: ReturnType<typeof parseSSHConfig>[number]): StudioConfig {
  return {
    ...existing,
    ssh: {
      user: selected.user || "",
      host: selected.host || selected.alias,
      identityFile: selected.identityFile || "",
      port: selected.port,
    },
    tunnel: {
      ...existing.tunnel,
      host: selected.host || selected.alias,
    },
  }
}

function hostSummaries(hosts: ReturnType<typeof parseSSHConfig>) {
  return hosts.map((h) => ({ alias: h.alias, host: h.host, user: h.user, hasKey: !!h.identityFile }))
}

/** Providers already present in OpenCode config that look local. */
export function detectConfiguredLocalProviders(): string[] {
  const config = getLatestConfig()
  if (!config?.provider) return []
  const found: string[] = []
  for (const id of Object.keys(config.provider)) {
    const lower = id.toLowerCase()
    if ((LOCAL_PROVIDERS as readonly string[]).includes(lower) || /ollama|lmstudio|local/.test(lower)) {
      found.push(id)
    }
  }
  return found
}

/** Probe Ollama's default HTTP port. */
export async function probeOllama(timeoutMs = 400): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

function sshStatusPayload() {
  const existing = loadConfig()
  const hosts = parseSSHConfig()
  if (hosts.length === 0) {
    return {
      status: "no_hosts" as const,
      message: "No SSH hosts found in ~/.ssh/config. Add hosts to ~/.ssh/config or configure manually.",
    }
  }
  if (existing.ssh.host) {
    return {
      status: "already_configured" as const,
      ssh: { host: existing.ssh.host, user: existing.ssh.user, port: existing.ssh.port },
      all_hosts: hostSummaries(hosts),
      message:
        "Studio SSH is configured. Use studio_setup({ action: \"ssh\", host: '<alias>', force: true }) to switch hosts.",
    }
  }
  return {
    status: "candidates" as const,
    all_hosts: hostSummaries(hosts),
    message: `Found ${hosts.length} SSH host(s). Confirm with studio_setup({ host: "<alias>" }) — nothing was saved.`,
  }
}

async function runOnboard(args: {
  prefer_local?: boolean
  budget_usd?: number
  disable_budget?: boolean
}): Promise<string> {
  const configuredLocal = detectConfiguredLocalProviders()
  const ollamaReachable = await probeOllama()
  const localAvailable = configuredLocal.length > 0 || ollamaReachable

  const actions: string[] = []
  let preferLocal = getPreferLocalModels()
  const wantPreferLocal = args.prefer_local ?? (localAvailable && !preferLocal ? true : undefined)
  if (wantPreferLocal === true && !preferLocal) {
    preferLocal = setPreferLocalModels(true)
    clearStudioRoutedAgents()
    await refreshModelRouting()
    actions.push("prefer_local → true")
  } else if (wantPreferLocal === false && preferLocal) {
    preferLocal = setPreferLocalModels(false)
    clearStudioRoutedAgents()
    await refreshModelRouting()
    actions.push("prefer_local → false")
  }

  // Budget: disable_budget / budget_usd=0 → unlimited; positive → set; omit → default $5 if never chosen
  let budget = getSessionBudgetUsd()
  const disable =
    args.disable_budget === true ||
    (args.budget_usd !== undefined && args.budget_usd <= 0)

  if (disable) {
    setSessionBudgetUsd(null)
    budget = null
    actions.push("session_budget → unlimited (disabled)")
  } else if (args.budget_usd != null && args.budget_usd > 0) {
    budget = setSessionBudgetUsd(args.budget_usd)
    actions.push(`session_budget → $${(budget ?? args.budget_usd).toFixed(2)}`)
  } else if (!hasExplicitBudget()) {
    budget = setSessionBudgetUsd(DEFAULT_SESSION_BUDGET_USD)
    actions.push(`session_budget → $${DEFAULT_SESSION_BUDGET_USD.toFixed(2)} (default — say "disable budget" anytime)`)
  }

  const tooling = detectTooling(getActiveDirectory())
  const verify = tooling.verifyCommands
  const verifyLines = [
    verify.test && `- test: \`${verify.test}\``,
    verify.lint && `- lint: \`${verify.lint}\``,
    verify.typecheck && `- typecheck: \`${verify.typecheck}\``,
    verify.build && `- build: \`${verify.build}\``,
  ].filter(Boolean)

  const localLine = configuredLocal.length
    ? configuredLocal.join(", ")
    : ollamaReachable
      ? "Ollama reachable on :11434 (not yet in OpenCode provider config)"
      : "none detected — connect Ollama / LM Studio, then set_prefer_local"

  const budgetLabel =
    budget == null
      ? "unlimited (disabled)"
      : `$${budget.toFixed(2)}${hasExplicitBudget() ? "" : " (default)"}`

  const card = [
    `# You're set — OpenCode Studio`,
    "",
    `**Project:** ${tooling.projectType.ecosystem || "unknown"} (${tooling.projectType.runner || "n/a"})`,
    `**Prefer local:** ${preferLocal ? "yes" : "no"}`,
    `**Session budget:** ${budgetLabel}`,
    `**Local providers:** ${localLine}`,
    "",
    verifyLines.length
      ? `**Verify commands** (studio_verify):\n${verifyLines.join("\n")}`
      : "**Verify commands:** none auto-detected — set via project tooling or run studio_verify to probe.",
    "",
    actions.length ? `**Applied:** ${actions.join("; ")}` : "**Applied:** nothing new (already configured)",
    "",
    "**Budget later:** `studio_preferences set_session_budget 10` · `set_session_budget 0` to disable · say \"budget $5\" / \"disable budget\"",
    "**Next:** `studio_doctor` · `studio_help topic=overview` · optional SSH: `studio_setup({ host: \"<alias>\" })`",
  ].join("\n")

  return JSON.stringify(
    {
      status: "onboarded",
      prefer_local: preferLocal,
      session_budget_usd: budget,
      budget_disabled: budget == null,
      local_providers: configuredLocal,
      ollama_reachable: ollamaReachable,
      project_type: tooling.projectType,
      verify_commands: verify,
      actions,
      message: card,
    },
    null,
    2,
  )
}

export const studio_setup: ToolDefinition = tool({
  description:
    "First-run setup: status, SSH host binding, or onboard wizard (local providers, session budget, verify commands). " +
      "Onboard: pass budget_usd to set, disable_budget=true or budget_usd=0 to disable (unlimited). " +
      "SSH binds only when you pass host=<alias> explicitly.",
  args: {
    action: tool.schema
      .enum(["status", "ssh", "onboard"])
      .optional()
      .describe("status (default if no host) | ssh | onboard"),
    force: tool.schema
      .boolean()
      .optional()
      .describe("Force re-bind even if SSH is already configured (still requires host)"),
    host: tool.schema
      .string()
      .optional()
      .describe("SSH host alias to bind (from ~/.ssh/config). Required to persist — omit to list candidates only."),
    prefer_local: tool.schema
      .boolean()
      .optional()
      .describe("Onboard: set prefer_local (default true when Ollama/local detected)"),
    budget_usd: tool.schema
      .number()
      .optional()
      .describe(
        `Onboard: session budget USD (omit = default $${DEFAULT_SESSION_BUDGET_USD} if never set; 0 = disable/unlimited)`,
      ),
    disable_budget: tool.schema
      .boolean()
      .optional()
      .describe("Onboard: disable session spend cap (unlimited). Same as budget_usd=0."),
  },
  async execute(args) {
    const action = args.action ?? (args.host ? "ssh" : "status")

    if (action === "onboard") {
      return runOnboard({
        prefer_local: args.prefer_local,
        budget_usd: args.budget_usd,
        disable_budget: args.disable_budget,
      })
    }

    const existing = loadConfig()
    const hosts = parseSSHConfig()

    if (action === "status" && !args.host && !args.force) {
      const ssh = sshStatusPayload()
      const budget = getSessionBudgetUsd()
      return JSON.stringify(
        {
          ...ssh,
          prefer_local: getPreferLocalModels(),
          session_budget_usd: budget,
          budget_explicit: hasExplicitBudget(),
          budget_disabled: hasExplicitBudget() && budget == null,
          local_providers: detectConfiguredLocalProviders(),
          tip:
            "First-run: studio_setup({ action: \"onboard\", budget_usd: 5 }) or disable_budget: true. " +
            "Later: say \"budget $10\" / \"disable budget\".",
        },
        null,
        2,
      )
    }

    if (hosts.length === 0) {
      return JSON.stringify({
        status: "no_hosts",
        message: "No SSH hosts found in ~/.ssh/config. Add hosts to ~/.ssh/config or configure manually.",
      })
    }

    if (existing.ssh.host && !args.force && !args.host) {
      return JSON.stringify({
        status: "already_configured",
        ssh: { host: existing.ssh.host, user: existing.ssh.user, port: existing.ssh.port },
        all_hosts: hostSummaries(hosts),
        message:
          "Studio is already configured. Use studio_setup({ host: '<alias>', force: true }) to switch hosts.",
      })
    }

    if (!args.host) {
      return JSON.stringify({
        status: "candidates",
        all_hosts: hostSummaries(hosts),
        message: `Found ${hosts.length} SSH host(s). Confirm with studio_setup({ host: "<alias>" }) — nothing was saved.`,
      })
    }

    const selected = hosts.find((h) => h.alias === args.host)
    if (!selected) {
      return JSON.stringify({
        status: "not_found",
        requested: args.host,
        all_hosts: hostSummaries(hosts),
        message: `Host '${args.host}' not found in ~/.ssh/config. Available: ${hosts.map((h) => h.alias).join(", ")}`,
      })
    }

    saveConfig(applyHost(existing, selected))
    return JSON.stringify({
      status: "selected",
      host: selected.alias,
      all_hosts: hostSummaries(hosts),
      message: `Selected '${selected.alias}' (${selected.user}@${selected.host}). Run studio_status to verify.`,
    })
  },
})
