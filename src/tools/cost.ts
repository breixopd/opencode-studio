import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getCostSummary, formatCostSummary, pruneOldCostEvents } from "../core/cost"

export const studio_cost: ToolDefinition = tool({
  description:
    "Token cost ledger — per-session and per-task token usage + $ cost breakdown by model and agent. " +
      "Use without args for this session's total; this_session=false for all sessions.",
  args: {
    this_session: tool.schema
      .boolean()
      .optional()
      .describe("Scope to current message's session (default true). Set false for all-time totals."),
    since_hours: tool.schema
      .number()
      .optional()
      .describe("Only show costs from the last N hours (e.g. 24 = last day). Omit for all-time."),
    prune: tool.schema
      .boolean()
      .optional()
      .describe("Delete cost events older than 30 days to free space. Returns count deleted."),
  },
  async execute(args, ctx) {
    if (args.prune) {
      const deleted = pruneOldCostEvents()
      return `Pruned ${deleted} cost event(s) older than 30 days.`
    }

    const summary = getCostSummary({
      sessionId: args.this_session === false ? undefined : ctx?.sessionID,
      sinceMs: args.since_hours ? Date.now() - args.since_hours * 3600_000 : undefined,
    })

    if (summary.messageCount === 0) {
      return "No cost data yet. Cost events are recorded automatically as the session runs."
    }

    return formatCostSummary(summary)
  },
})
