import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getAutonomyMode } from "../core/project-profile"
import { formatScoutReport, invalidateScoutCache, runScout } from "../core/scout"

/**
 * studio_scout — autonomous improvement finder.
 * Agents should call this when idle or when user asks "what can we improve?".
 * Findings also auto-inject via discipline when autonomy ≠ off.
 */
export const studio_scout: ToolDefinition = tool({
  description:
    "Autonomous improvement scout: finds verify failures, test gaps, polish opportunities, " +
      "hotspots, open concerns, and process debt. Surfaces suggestions without the user asking. " +
      "Opt out with studio_preferences set_autonomy off.",
  args: {
    action: tool.schema
      .enum(["run", "status"])
      .optional()
      .describe("run=scan now (default) | status=show autonomy mode + cached hint"),
    max: tool.schema.number().optional().describe("Max findings (default 8)"),
  },
  async execute(args) {
    const mode = getAutonomyMode()
    if (args.action === "status") {
      return [
        `Autonomy mode: ${mode}`,
        mode === "off"
          ? "Scout injection disabled. Enable with studio_preferences set_autonomy suggest|full"
          : "Scout findings inject into session context automatically.",
        "Natural language: say \"don't scout\" to disable, \"be proactive\" for full, \"suggest only\" for suggest.",
      ].join("\n")
    }

    invalidateScoutCache()
    const findings = runScout(process.cwd(), args.max ?? 8)
    return formatScoutReport(findings, mode)
  },
})
