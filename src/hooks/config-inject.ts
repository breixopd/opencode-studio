import type { Config } from "@opencode-ai/plugin"
import { ensureStudioReady } from "../core/auto"
import { applyStudioModelRouting, setLatestConfig } from "../core/model-routing"
import { fetchZenModelIds } from "../core/model-catalog"
import {
  describeProviderChange,
  syncProviderModelsFromConfig,
} from "../core/model-registry"
import { setPendingCatalogNotice } from "../core/project-profile"
import { findTool } from "../core/tool-catalog"

// ——— Agent metadata — single source of truth for all studio subagents ————————————————

interface AgentDef {
  name: string
  description: string
  /** Tools this agent should use (looked up from catalog for descriptions) */
  tools: string[]
  /** Tools the agent must NOT use */
  denyTools?: string[]
  /** Phase-appropriate guidance (behavioral, not tool lists) */
  guidance: string
  edit: "allow" | "deny" | "ask"
  bash: "allow" | "deny" | "ask"
}

const AGENT_DEFS: AgentDef[] = [
  {
    name: "studio-explore",
    description: "Read-only codebase exploration",
    tools: ["studio_glob", "studio_symbols", "studio_index", "studio_grep", "studio_help"],
    guidance: "Explore read-only. Start with glob to understand structure, then symbols outline, then index semantic for deeper understanding. Never make edits.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-research",
    description: "Official docs, examples, and solutions",
    tools: ["studio_search", "studio_fetch", "studio_crawl", "studio_code_search"],
    guidance: "Research with studio_search (use scrape:true for top hits). Prefer primary sources (official docs, RFCs, source code). Cite URLs. Studio_fetch for specific pages, studio_crawl for multi-page docs.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-architect",
    description: "Architecture and plan review",
    tools: ["studio_index", "studio_symbols", "studio_refactor", "studio_plan", "studio_deps"],
    guidance: "Review design read-only: boundaries, data flow, file structure, trade-offs. Check for coupling, dead code (studio_refactor dead_code), and dependency issues (studio_deps audit). Align recommendations with the active studio_plan. No code edits.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-security",
    description: "Security review — threats, secrets, auth, injection",
    tools: ["studio_index", "studio_grep", "studio_deps", "studio_git"],
    guidance: "Security review read-only: OWASP risks, secrets in code, authn/z flaws, injection vectors, dependency vulnerabilities (studio_deps audit), least privilege. Check for hardcoded credentials with studio_grep. Flag blockers before ship — not nice-to-haves.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-implement",
    description: "Implements features — research first, then code",
    tools: ["studio_index", "studio_symbols", "studio_grep", "studio_git", "studio_verify", "studio_spec", "studio_plan", "studio_task"],
    guidance: "Research APIs first (studio_index, studio_grep). Follow the active plan. Write tests first (TDD). Handle edge cases: empty input, boundary values, error paths. Use studio_git for staging/committing. Run studio_verify before reporting done. If verify fails, fix and retry — the grind loop will guide you.",
    edit: "allow",
    bash: "allow",
  },
  {
    name: "studio-review",
    description: "Code review — correctness, tests, maintainability",
    tools: ["studio_index", "studio_refactor", "studio_symbols", "studio_git"],
    guidance: "Review read-only: bugs, edge cases, test gaps, plan adherence, code smells. Use studio_refactor structure to find long functions and dead code. Check if the implementation matches the active plan's acceptance criteria. No edits.",
    edit: "deny",
    bash: "deny",
  },
  {
    name: "studio-verify",
    description: "Runs verification — test, lint, typecheck, build",
    tools: ["studio_verify"],
    guidance: "Run studio_verify. Report failures with file:line in the output. If verify fails persistently (3x), suggest snapshot+rollback. Do not fix issues yourself — report them for @studio-implement.",
    edit: "deny",
    bash: "allow",
  },
  {
    name: "studio-remote",
    description: "Remote development — SSH exec, sync, tunnel",
    tools: ["studio_remote", "studio_sync_start", "studio_sync_stop", "studio_tunnel_status", "studio_tunnel_restart", "studio_status"],
    guidance: "Remote dev via studio tools. Sync is automatic on session start. Use studio_remote to run commands on remote hosts. Check studio_status for overall health.",
    edit: "allow",
    bash: "allow",
  },
]

/** Build the agent config from definitions + tool catalog. */
function buildAgentConfig(): NonNullable<Config["agent"]> {
  const config: NonNullable<Config["agent"]> = {}
  for (const def of AGENT_DEFS) {
    // Build tool guidance from catalog descriptions (auto-updated when catalog changes)
    const toolHints = def.tools
      .map((name) => {
        const tool = findTool(name)
        return tool ? `${name} (${tool.description})` : name
      })
      .join(", ")

    config[def.name] = {
      mode: "subagent",
      description: def.description,
      prompt: `${def.guidance}\n\nAvailable tools: ${toolHints}`,
      permission: { edit: def.edit, bash: def.bash },
    }
  }
  return config
}

export function createConfigInjectHook() {
  return async (config: Config) => {
    ensureStudioReady()

    config.agent ??= {}
    for (const [name, def] of Object.entries(buildAgentConfig())) {
      if (!config.agent![name]) config.agent![name] = def
    }

    config.command ??= {}
    const commands: NonNullable<Config["command"]> = {
      "deep-dive": {
        description: "Explore codebase",
        template: "Explore: {{args}}",
        agent: "studio-explore",
        subtask: true,
      },
      research: {
        description: "Research docs/examples",
        template: "Research: {{args}}",
        agent: "studio-research",
        subtask: true,
      },
      architect: {
        description: "Review architecture/plan",
        template: "Review architecture for: {{args}}",
        agent: "studio-architect",
        subtask: true,
      },
      security: {
        description: "Security review",
        template: "Security review: {{args}}",
        agent: "studio-security",
        subtask: true,
      },
      review: {
        description: "Code review",
        template: "Code review: {{args}}",
        agent: "studio-review",
        subtask: true,
      },
      verify: {
        description: "Run checks",
        template: "Run studio_verify.",
        agent: "studio-verify",
        subtask: true,
      },
      plan: {
        description: "Write a plan",
        template: "studio_plan write for: {{args}}",
      },
      handoff: {
        description: "Ship handoff",
        template: "studio_handoff for: {{args}}",
      },
      "smoke-test": {
        description: "Run full studio smoke test and collect report",
        template:
          "Smoke test (use free models for subagents):\n1) studio_help topic=overview\n2) studio_doctor\n3) studio_brief show\n4) studio_symbols action=stats\n5) studio_plan write for: add greet.ts + test\n6) studio_task create \"Add greet\"\n7) @studio-explore (read-only)\n8) implement greet in src/greet.ts + test\n9) studio_context pin \"smoke test contract\"\n10) studio_verify\n11) studio_handoff summary=\"smoke\" (expect pass after verify)\n12) studio_report — paste FULL JSON",
      },
      help: {
        description: "Studio help — setup, tools, workflow",
        template: "studio_help topic={{args}}",
      },
      "start-work": {
        description: "Full SDLC workflow",
        template:
          "SDLC for {{args}}:\n1) studio_brief show + explore\n2) research\n3) studio_plan\n4) @studio-architect + @studio-security if needed\n5) studio_task\n6) implement\n7) @studio-review\n8) studio_verify\n9) studio_handoff",
      },
    }
    for (const [name, def] of Object.entries(commands)) {
      if (!config.command![name]) config.command![name] = def
    }

    config.tools ??= {}
    if (config.tools.websearch === undefined) config.tools.websearch = true
    if (config.tools.webfetch === undefined) config.tools.webfetch = true
    if (config.tools.task === undefined) config.tools.task = true
    if ((config.tools as Record<string, boolean | undefined>).question === undefined) {
      ;(config.tools as Record<string, boolean>).question = true
    }

    setLatestConfig(config)
    syncProviderModelsFromConfig(config)
    const providerNotice = describeProviderChange(config)
    if (providerNotice) setPendingCatalogNotice(providerNotice)
    applyStudioModelRouting(config, await fetchZenModelIds())
  }
}
