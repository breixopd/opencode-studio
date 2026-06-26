import { STUDIO_DISCIPLINE } from "../core/discipline"
import { openTasksSystemBlock } from "../core/studio-context"
import { studioStableContext, studioDynamicContext } from "../core/workspace"
import { branchSwitchNotice } from "../core/branch-context"
import { getPendingCatalogNotice } from "../core/project-profile"
import { isTunnelDegraded, getTunnelFailureCount } from "../tunnel/manager"
import { diagnosticsContextBlock } from "../core/diagnostics"
import { resumeCard } from "../core/resume-card"
import { costPreviewBlock } from "../core/cost-preview"
import { grindContextBlock } from "../core/self-heal"
import { constitutionContextBlock } from "../core/constitution"
import { getCISummary } from "../core/ci-watcher"
import { memoryContextBlock } from "../core/auto-memory"
import { getRecurringCorrectionNotices } from "./chat-message"

/**
 * System prompt ordering for prompt-cache stability:
 *
 *   [STABLE PREFIX — cache hits]
 *   1. STUDIO_DISCIPLINE (module-level constant, never changes)
 *   2. studioStableContext() — project profile, user rules (rarely change)
 *
 *   [DYNAMIC SUFFIX — changes per-turn]
 *   3. studioDynamicContext() — active plan, pinned context, verify state
 *   4. Open tasks block
 *   5. Catalog notice (providers changed)
 *   6. Branch switch notice
 *
 * Anthropic & OpenAI both cache stable prefixes. By keeping the discipline +
 * project identity + rules at the start and the per-turn state at the end,
 * we get maximum cache hits and minimize re-processing of unchanged tokens.
 */
export function createDisciplineSystemHook() {
  return async (_input: { sessionID?: string }, output: { system: string[] }) => {
    // —— STABLE PREFIX ———————————————————————————————————
    // Discipline block first — it's a module-level constant, never mutates.
    if (!output.system.includes(STUDIO_DISCIPLINE)) {
      output.system.push(STUDIO_DISCIPLINE)
    }

    // Stable context: project profile + user rules (change rarely → cacheable).
    for (const block of studioStableContext()) {
      pushIfNotPresent(output.system, block)
    }

    // Auto-memory index — agent-driven learnings (topic files loaded on demand).
    const memory = memoryContextBlock()
    if (memory) pushIfNotPresent(output.system, memory)

    // —— DYNAMIC SUFFIX ———————————————————————————————————
    // Plan, pinned context, verify state — changes per-turn.
    for (const block of studioDynamicContext()) {
      pushIfNotPresent(output.system, block)
    }

    // Open tasks — changes on every task update.
    const tasks = openTasksSystemBlock()
    if (tasks) pushIfNotPresent(output.system, tasks)

    // LSP diagnostics — active type/lint errors from the language server.
    const diags = diagnosticsContextBlock(process.cwd())
    if (diags) pushIfNotPresent(output.system, diags)

    // Cross-session resume card — synthesized context for continuing work.
    const resume = resumeCard(process.cwd())
    if (resume) pushIfNotPresent(output.system, resume)

    // Pre-flight cost preview — estimated cost for remaining work.
    const costPreview = costPreviewBlock(process.cwd())
    if (costPreview) pushIfNotPresent(output.system, costPreview)

    // Project constitution — coding standards auto-injected if present.
    const constitution = constitutionContextBlock(process.cwd())
    if (constitution) pushIfNotPresent(output.system, constitution)

    // CI status — failing workflows injected if CI watcher is active.
    const ci = getCISummary()
    if (ci) pushIfNotPresent(output.system, ci)

    const catalogNotice = getPendingCatalogNotice()
    if (catalogNotice) {
      pushIfNotPresent(
        output.system,
        `[studio catalog] ${catalogNotice} Run studio_models refresh_all when ready.`,
      )
    }

    const branchNotice = branchSwitchNotice()
    if (branchNotice) pushIfNotPresent(output.system, branchNotice)

    // Self-healing: grind count / auto-rollback recommendation.
    const grind = grindContextBlock(process.cwd())
    if (grind) pushIfNotPresent(output.system, grind)

    // Recurring correction patterns — surface when user corrects the same thing ≥3x.
    const patterns = getRecurringCorrectionNotices()
    if (patterns) pushIfNotPresent(output.system, patterns)

    // Phase 6.1 — tunnel watchdog: inject notice when tunnel is degraded.
    if (isTunnelDegraded()) {
      pushIfNotPresent(
        output.system,
        `[studio tunnel] DOWN ${getTunnelFailureCount()}x — run studio_tunnel_restart. Remote sync may be interrupted.`,
      )
    }
  }
}

/**
 * Push a block to the system array only if not already present.
 * Uses a stable block-prefix key (first line up to 64 chars) for dedup
 * rather than just 40 chars — avoids false positives when two blocks
 * share a common header like "[studio]".
 */
function pushIfNotPresent(system: string[], block: string): void {
  const key = block.split("\n")[0].slice(0, 64)
  if (!system.some((s) => s.split("\n")[0].slice(0, 64) === key)) {
    system.push(block)
  }
}
