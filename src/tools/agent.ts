import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  syncAgentProfiles,
  saveCustomAgent,
  listAgentProfiles,
  removeCustomAgent,
} from "../core/agent-profiles"

export const studio_agent: ToolDefinition = tool({
  description:
    "Manage agent profiles — list, sync (regenerate from tool catalog), create custom, remove. " +
      "Agents are written to .opencode/agents/ so OpenCode picks them up natively.",
  args: {
    action: tool.schema
      .enum(["list", "sync", "create", "remove"])
      .describe("list=all agents | sync=regenerate studio profiles | create=custom agent | remove=delete custom agent"),
    name: tool.schema.string().optional().describe("Agent name (for create/remove)"),
    description: tool.schema.string().optional().describe("Agent description (for create)"),
    prompt: tool.schema.string().optional().describe("Agent system prompt (for create)"),
    tools: tool.schema.array(tool.schema.string()).optional().describe("Tool names this agent can use (for create)"),
    edit: tool.schema.enum(["allow", "deny", "ask"]).optional().describe("Edit permission (default: deny)"),
    bash: tool.schema.enum(["allow", "deny", "ask"]).optional().describe("Bash permission (default: deny)"),
    model: tool.schema.string().optional().describe("Model override (e.g. anthropic/claude-sonnet-4)"),
  },
  async execute(args) {
    const cwd = process.cwd()

    switch (args.action) {
      case "list": {
        const profiles = listAgentProfiles(cwd)
        if (!profiles.length) return "No agent profiles. Run studio_agent action=sync to generate studio agents."
        const lines = ["# Agent profiles", ""]
        const studio = profiles.filter((p) => p.isStudio)
        const custom = profiles.filter((p) => !p.isStudio)
        if (studio.length) {
          lines.push("## Studio agents (auto-generated)")
          for (const p of studio) lines.push(`- ${p.name}`)
        }
        if (custom.length) {
          lines.push("", "## Custom agents")
          for (const p of custom) lines.push(`- ${p.name}`)
        }
        return lines.join("\n")
      }

      case "sync": {
        const count = syncAgentProfiles(cwd)
        return count > 0
          ? `Synced ${count} agent profile(s) to .opencode/agents/. OpenCode will pick them up natively.`
          : "Agent profiles already up to date."
      }

      case "create": {
        if (!args.name?.trim()) return "name required for create"
        if (!args.description?.trim()) return "description required for create"
        if (!args.prompt?.trim()) return "prompt required for create"
        if (!args.tools?.length) return "tools (at least one) required for create"

        const path = saveCustomAgent(cwd, {
          name: args.name.trim(),
          description: args.description.trim(),
          prompt: args.prompt.trim(),
          tools: args.tools,
          edit: args.edit ?? "deny",
          bash: args.bash ?? "deny",
          model: args.model,
        })
        return `Custom agent saved: ${args.name}\nPath: ${path}\n\nThe agent is now available via @${args.name} in chat.`
      }

      case "remove": {
        if (!args.name?.trim()) return "name required for remove"
        try {
          const removed = removeCustomAgent(cwd, args.name.trim())
          return removed ? `Custom agent removed: ${args.name}` : `Agent not found: ${args.name}`
        } catch (err) {
          return (err as Error).message
        }
      }

      default:
        return `Unknown action: ${args.action}`
    }
  },
})
