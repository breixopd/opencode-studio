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
import { AGENT_DEFS } from "../core/agent-defs"
import { startWorkFanOutStep } from "../core/fan-out"

/** Build the agent config from shared AGENT_DEFS + tool catalog. */
function buildAgentConfig(): NonNullable<Config["agent"]> {
  const config: NonNullable<Config["agent"]> = {}
  for (const def of AGENT_DEFS) {
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
        description: "Full SDLC workflow with smart parallel fan-out",
        template:
          `SDLC for {{args}}:\n1) studio_brief show\n2) ${startWorkFanOutStep()}\n3) Synthesize agent findings\n4) studio_spec (generate requirements + acceptance)\n5) studio_plan\n6) studio_task\n7) @studio-implement\n8) @studio-review\n9) studio_verify (only=snapshot first)\n10) studio_handoff`,
      },
      council: {
        description: "Model Council — multi-lens review (security, architecture, correctness, maintainability)",
        template: "studio_council action=review {{args}}",
      },
      "council-plan": {
        description: "Model Council — multi-lens architecture review for a goal",
        template: "studio_council action=plan goal='{{args}}'",
      },
      scout: {
        description: "Autonomous improvement scout — find polish/test/research opportunities",
        template: "Run studio_scout. Summarize findings by severity and propose next steps (verify-first).",
        agent: "studio-scout",
        subtask: true,
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
