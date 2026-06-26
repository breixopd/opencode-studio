/**
 * Per-task cost ledger (Phase 3.6 — the differentiator).
 *
 * Captures token usage + $ cost from every assistant message and attributes
 * it to (session, agent, model, branch, task). Backed by the `cost_events`
 * table in `.studio/studio.db`.
 *
 * The opencode SDK fires `message.updated` events with the full AssistantMessage
 * (including `cost: number` and `tokens: {input, output, reasoning, cache}`).
 * This module records each one. The `studio_cost` tool queries the ledger.
 */
import type { SQLQueryBindings } from "bun:sqlite"
import { openStudioDb, queryAll, runQuery } from "./studio-db"
import { currentBranch } from "./branch-context"
import { getActivePlanId, getActiveTasks } from "./workspace"

export interface CostEvent {
  sessionId: string
  messageId: string
  agent: string | null
  providerId: string
  modelId: string
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  branch: string | null
  cwd: string | null
  taskId: string | null
  createdAt: number
}

export interface CostSummary {
  totalCost: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
  messageCount: number
  byModel: Array<{ providerId: string; modelId: string; cost: number; tokens: number }>
  byAgent: Array<{ agent: string; cost: number; tokens: number; messages: number }>
}

/** Record a cost event from an AssistantMessage. Idempotent on message_id. */
export function recordCostEvent(msg: {
  id: string
  sessionID: string
  providerID: string
  modelID: string
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  time: { created: number }
  path?: { cwd: string; root: string }
  agent?: string
}): void {
  const d = openStudioDb(process.cwd())
  const branch = currentBranchSafe()
  const taskId = activeTaskIdSafe()

  runQuery(
    d,
    `INSERT OR IGNORE INTO cost_events
     (session_id, message_id, agent, provider_id, model_id,
      tokens_input, tokens_output, tokens_reasoning,
      cache_read, cache_write, cost_usd, branch, cwd, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.sessionID,
      msg.id,
      msg.agent ?? null,
      msg.providerID,
      msg.modelID,
      msg.tokens.input ?? 0,
      msg.tokens.output ?? 0,
      msg.tokens.reasoning ?? 0,
      msg.tokens.cache.read ?? 0,
      msg.tokens.cache.write ?? 0,
      msg.cost ?? 0,
      branch,
      msg.path?.cwd ?? null,
      taskId,
      msg.time.created ?? 0,
    ],
  )
}

/** Get the cost summary for a session (or all sessions if omitted). */
export function getCostSummary(opts?: {
  sessionId?: string
  sinceMs?: number
  branch?: string
}): CostSummary {
  const d = openStudioDb(process.cwd())
  const where: string[] = []
  const params: SQLQueryBindings[] = []

  if (opts?.sessionId) {
    where.push("session_id = ?")
    params.push(opts.sessionId)
  }
  if (opts?.sinceMs) {
    where.push("created_at >= ?")
    params.push(opts.sinceMs)
  }
  if (opts?.branch) {
    where.push("branch = ?")
    params.push(opts.branch)
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : ""

  const totals = queryAll<{
    total_cost: number
    total_input: number
    total_output: number
    total_reasoning: number
    total_cache_read: number
    total_cache_write: number
    msg_count: number
  }>(
    d,
    `SELECT
       COALESCE(SUM(cost_usd), 0) AS total_cost,
       COALESCE(SUM(tokens_input), 0) AS total_input,
       COALESCE(SUM(tokens_output), 0) AS total_output,
       COALESCE(SUM(tokens_reasoning), 0) AS total_reasoning,
       COALESCE(SUM(cache_read), 0) AS total_cache_read,
       COALESCE(SUM(cache_write), 0) AS total_cache_write,
       COUNT(*) AS msg_count
     FROM cost_events ${whereClause}`,
    params,
  )[0]

  const byModel = queryAll<{
    provider_id: string
    model_id: string
    cost: number
    tokens: number
  }>(
    d,
    `SELECT provider_id, model_id,
       COALESCE(SUM(cost_usd), 0) AS cost,
       COALESCE(SUM(COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) + COALESCE(tokens_reasoning, 0)), 0) AS tokens
     FROM cost_events ${whereClause}
     GROUP BY provider_id, model_id
     ORDER BY cost DESC`,
    params,
  )

  const byAgent = queryAll<{
    agent: string
    cost: number
    tokens: number
    messages: number
  }>(
    d,
    `SELECT COALESCE(agent, '(main)') AS agent,
       COALESCE(SUM(cost_usd), 0) AS cost,
       COALESCE(SUM(COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) + COALESCE(tokens_reasoning, 0)), 0) AS tokens,
       COUNT(*) AS messages
     FROM cost_events ${whereClause}
     GROUP BY agent
     ORDER BY cost DESC`,
    params,
  )

  return {
    totalCost: totals.total_cost,
    totalTokens: {
      input: totals.total_input,
      output: totals.total_output,
      reasoning: totals.total_reasoning,
      cacheRead: totals.total_cache_read,
      cacheWrite: totals.total_cache_write,
    },
    messageCount: totals.msg_count,
    byModel: byModel.map((r) => ({
      providerId: r.provider_id,
      modelId: r.model_id,
      cost: r.cost,
      tokens: r.tokens,
    })),
    byAgent: byAgent.map((r) => ({ agent: r.agent, cost: r.cost, tokens: r.tokens, messages: r.messages })),
  }
}

/** Format the cost summary as a compact, token-cheap string for the agent. */
export function formatCostSummary(summary: CostSummary): string {
  const t = summary.totalTokens
  const lines = [
    `# Studio cost summary`,
    ``,
    `Total: **$${summary.totalCost.toFixed(4)}** across ${summary.messageCount} message(s)`,
    `Tokens: in=${t.input.toLocaleString()} out=${t.output.toLocaleString()} reason=${t.reasoning.toLocaleString()}` +
      ` cache_read=${t.cacheRead.toLocaleString()} cache_write=${t.cacheWrite.toLocaleString()}`,
  ]

  if (summary.byModel.length > 0) {
    lines.push("", "## By model")
    for (const m of summary.byModel) {
      lines.push(`- ${m.providerId}/${m.modelId}: $${m.cost.toFixed(4)} (${m.tokens.toLocaleString()} tokens)`)
    }
  }

  if (summary.byAgent.length > 0) {
    lines.push("", "## By agent")
    for (const a of summary.byAgent) {
      lines.push(`- ${a.agent}: $${a.cost.toFixed(4)} (${a.messages} msgs, ${a.tokens.toLocaleString()} tokens)`)
    }
  }

  return lines.join("\n")
}

/** Clear cost events older than `daysOld` (housekeeping). */
export function pruneOldCostEvents(daysOld = 30): number {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000
  const d = openStudioDb(process.cwd())
  const result = runQuery(d, "DELETE FROM cost_events WHERE created_at < ?", [cutoff])
  return result.changes
}

function currentBranchSafe(): string | null {
  try {
    return currentBranch() ?? null
  } catch {
    return null
  }
}

/** Get the active in-progress task ID, falling back to the plan ID. */
function activeTaskIdSafe(): string | null {
  try {
    const inProgress = getActiveTasks().find((t) => t.status === "in_progress")
    return inProgress?.id ?? getActivePlanId()
  } catch {
    return null
  }
}
