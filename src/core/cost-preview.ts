/**
 * Pre-flight cost preview — estimates token usage and $ cost before a run
 * based on historical cost data from the same session/agent.
 *
 * Injects a "estimated cost" block into the chat params hook so the agent
 * (and the user, via studio_cost) can see projected costs before
 * committing to an expensive operation.
 */
import { getCostSummary } from "./cost"
import { getActivePlan } from "./workspace"
import { incompleteTasks } from "./workspace"

export interface CostEstimate {
  estimatedCostUsd: number
  estimatedTokens: number
  confidence: "high" | "medium" | "low"
  basis: string
}

/**
 * Estimate the cost of the upcoming work based on:
 * - Average cost per task from historical data
 * - Number of incomplete tasks
 * - Active plan complexity
 */
export function estimateRunCost(_root: string): CostEstimate | null {
  const plan = getActivePlan()
  const tasks = incompleteTasks()

  if (tasks.length === 0 && !plan) return null

  // Get historical cost data for this project.
  const summary = getCostSummary({ sinceMs: 7 * 24 * 60 * 60 * 1000 }) // last 7 days

  if (summary.messageCount === 0) {
    // No historical data — give a rough estimate based on plan steps.
    const stepCount = plan?.steps.length ?? tasks.length
    return {
      estimatedCostUsd: stepCount * 0.02, // rough average: $0.02/step
      estimatedTokens: stepCount * 8000, // rough average: 8k tokens/step
      confidence: "low",
      basis: `rough estimate: ${stepCount} plan steps × $0.02/step (no historical data)`,
    }
  }

  // Historical estimate: average cost per message × estimated messages.
  const avgCostPerMsg = summary.totalCost / summary.messageCount
  const avgTokensPerMsg = summary.totalTokens.input + summary.totalTokens.output
  const estimatedMsgs = Math.max(tasks.length * 3, 5) // ~3 messages per task, min 5

  let confidence: "high" | "medium" | "low" = "medium"
  if (summary.messageCount > 20) confidence = "high"
  if (summary.messageCount < 5) confidence = "low"

  return {
    estimatedCostUsd: avgCostPerMsg * estimatedMsgs,
    estimatedTokens: (avgTokensPerMsg / summary.messageCount) * estimatedMsgs,
    confidence,
    basis: `${summary.messageCount} historical messages, ${tasks.length} open tasks, ~${estimatedMsgs} estimated messages`,
  }
}

/** Format the cost estimate as a compact context block. */
export function costPreviewBlock(root: string): string | null {
  const estimate = estimateRunCost(root)
  if (!estimate) return null

  const lines = [
    `[studio cost-preview] Estimated cost for remaining work:`,
    `  ~$${estimate.estimatedCostUsd.toFixed(4)} (${estimate.estimatedTokens.toLocaleString()} tokens)`,
    `  confidence: ${estimate.confidence} — ${estimate.basis}`,
  ]

  if (estimate.estimatedCostUsd > 0.50) {
    lines.push(`  ⚠ This run may cost >$0.50. Consider using a cheaper model mode (studio_preferences set_model_mode free).`)
  }

  return lines.join("\n")
}
