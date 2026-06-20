import type { Config } from "@opencode-ai/plugin"
import { ensureStudioReady } from "../core/auto"

const AGENTS: NonNullable<Config["agent"]> = {
  "studio-explore": {
    mode: "subagent",
    description: "Read-only parallel codebase exploration",
    prompt:
      "Explore read-only. Return file paths, patterns, risks, and how similar problems are solved in-repo. Use grep/glob/read.",
    permission: { edit: "deny", bash: "ask" },
  },
  "studio-implement": {
    mode: "subagent",
    description: "Implements features — researches APIs first, then writes code",
    prompt:
      "Before editing: check official docs/examples for APIs you use. Follow active plan and .studio/architecture.md. Implement in scope. Edge cases matter. Run studio_verify before done.",
    permission: { edit: "allow", bash: "allow" },
  },
  "studio-review": {
    mode: "subagent",
    description: "Review: correctness, security, performance, test quality",
    prompt:
      "Review read-only. Flag missing edge cases, wrong API usage vs docs, perf issues, weak tests. No edits.",
    permission: { edit: "deny", bash: "deny" },
  },
  "studio-research": {
    mode: "subagent",
    description: "Official docs and examples via studio_search/studio_fetch/studio_code_search",
    prompt:
      "Research official documentation and real code examples. Prefer primary sources. Cite URLs and summarize actionable findings for the main agent.",
    permission: { edit: "deny", bash: "deny" },
  },
  "studio-remote": {
    mode: "subagent",
    description: "Remote VPS sync and tunnel",
    prompt:
      "Remote dev via studio_* tools. Default remote path is /home/{user}/{project}. Save user overrides with studio_preferences set_remote_path.",
    permission: { edit: "allow", bash: "allow" },
  },
  "studio-verify": {
    mode: "subagent",
    description: "Runs tests/lint/build via studio_verify",
    prompt: "Run studio_verify. Report failures with file:line. Do not fix — only verify.",
    permission: { edit: "deny", bash: "allow" },
  },
}

export function createConfigInjectHook() {
  return async (config: Config) => {
    ensureStudioReady()

    config.agent ??= {}
    for (const [name, def] of Object.entries(AGENTS)) {
      if (!config.agent![name]) config.agent![name] = def
    }

    config.command ??= {}
    const commands: NonNullable<Config["command"]> = {
      "deep-dive": {
        description: "Parallel exploration subtask",
        template: "Explore thoroughly: {{args}}",
        agent: "studio-explore",
        subtask: true,
      },
      research: {
        description: "Research docs and examples before implementing",
        template:
          "Research official docs and real examples for: {{args}}. Use @studio-research. Summarize URLs and key findings in studio_plan.",
        agent: "studio-research",
        subtask: true,
      },
      verify: {
        description: "Run test/lint/build checks",
        template: "Run studio_verify and report results.",
        agent: "studio-verify",
        subtask: true,
      },
      plan: {
        description: "Create a structured plan with research section",
        template:
          "Research first, then studio_plan write for: {{args}}. Include docs/examples, edge cases, and test strategy.",
      },
      handoff: {
        description: "Write completion handoff",
        template: "Use studio_handoff summarizing work on: {{args}}",
      },
      "start-work": {
        description: "Full boulder workflow from research to handoff",
        template:
          "Full studio workflow for: {{args}}\n1) @studio-research docs/examples\n2) studio_plan write (architecture + file structure)\n3) studio_task create\n4) implement (parallel @studio-implement if large)\n5) studio_verify\n6) studio_task done for each\n7) studio_handoff\nUse question tool if blocked. studio_remember add when user says remember.",
      },
    }
    for (const [name, def] of Object.entries(commands)) {
      if (!config.command![name]) config.command![name] = def
    }

    config.tools ??= {}
    if (config.tools.websearch === undefined) config.tools.websearch = true
    if (config.tools.webfetch === undefined) config.tools.webfetch = true
    if (config.tools.task === undefined) config.tools.task = true
    // Built-in OpenCode tool — ask user structured questions when decisions are needed
    if ((config.tools as Record<string, boolean | undefined>).question === undefined) {
      ;(config.tools as Record<string, boolean>).question = true
    }
  }
}
