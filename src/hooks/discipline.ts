import { STUDIO_DISCIPLINE } from "../core/discipline"
import { openTasksSystemBlock } from "../core/workspace-context"
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
import { workingSetContextBlock } from "../core/passive-context"
import { checkPlanDrift } from "../core/plan-drift"
import { scoutContextBlock } from "../core/scout"
import { budgetContextBlock, budgetFirstRunPrompt } from "../core/budget"
import { sshSetupSuggestion } from "../core/auto"
import * as log from "../core/logger"
import { getActiveDirectory } from "../core/active-dir"

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
    const before = output.system.length

    // —— STABLE PREFIX ———————————————————————————————————
    if (!output.system.includes(STUDIO_DISCIPLINE)) {
      output.system.push(STUDIO_DISCIPLINE)
      log.debugContext("discipline", STUDIO_DISCIPLINE.length)
    }

    for (const block of studioStableContext()) {
      pushIfNotPresent(output.system, block)
      log.debugContext("stable", block.length)
    }

    const memory = memoryContextBlock()
    if (memory) {
      pushIfNotPresent(output.system, memory)
      log.debugContext("memory", memory.length)
    }

    // —— DYNAMIC SUFFIX ———————————————————————————————————
    for (const block of studioDynamicContext()) {
      pushIfNotPresent(output.system, block)
      log.debugContext("dynamic", block.length)
    }

    const tasks = openTasksSystemBlock()
    if (tasks) { pushIfNotPresent(output.system, tasks); log.debugContext("tasks", tasks.length) }

    const diags = diagnosticsContextBlock(getActiveDirectory())
    if (diags) { pushIfNotPresent(output.system, diags); log.debugContext("diagnostics", diags.length) }

    const resume = resumeCard(getActiveDirectory())
    if (resume) { pushIfNotPresent(output.system, resume); log.debugContext("resume", resume.length) }

    const costPreview = costPreviewBlock(getActiveDirectory())
    if (costPreview) { pushIfNotPresent(output.system, costPreview); log.debugContext("cost-preview", costPreview.length) }

    const constitution = constitutionContextBlock(getActiveDirectory())
    if (constitution) { pushIfNotPresent(output.system, constitution); log.debugContext("constitution", constitution.length) }

    const ci = getCISummary()
    if (ci) { pushIfNotPresent(output.system, ci); log.debugContext("ci", ci.length) }

    const catalogNotice = getPendingCatalogNotice()
    if (catalogNotice) {
      pushIfNotPresent(output.system, `[studio catalog] ${catalogNotice} Run studio_models refresh_all when ready.`)
      log.debugContext("catalog", catalogNotice.length)
    }

    const branchNotice = branchSwitchNotice()
    if (branchNotice) { pushIfNotPresent(output.system, branchNotice); log.debugContext("branch", branchNotice.length) }

    const grind = grindContextBlock(getActiveDirectory())
    if (grind) { pushIfNotPresent(output.system, grind); log.debugContext("grind", grind.length) }

    // Passive context — recently edited files (auto-tracked, no user action needed).
    const workingSet = workingSetContextBlock()
    if (workingSet) { pushIfNotPresent(output.system, workingSet); log.debugContext("working-set", workingSet.length) }

    // Plan drift detection — warn if implementation diverges from plan.
    const drift = checkPlanDrift()
    if (drift) { pushIfNotPresent(output.system, drift); log.debugContext("drift", drift.length) }

    // Autonomous scout — polish/test/research opportunities (respects autonomy opt-out).
    const scout = scoutContextBlock(getActiveDirectory())
    if (scout) { pushIfNotPresent(output.system, scout); log.debugContext("scout", scout.length) }

    const budgetFirst = budgetFirstRunPrompt()
    if (budgetFirst) { pushIfNotPresent(output.system, budgetFirst); log.debugContext("budget-first-run", budgetFirst.length) }

    const budget = budgetContextBlock(_input.sessionID)
    if (budget) { pushIfNotPresent(output.system, budget); log.debugContext("budget", budget.length) }

    const sshSuggest = sshSetupSuggestion()
    if (sshSuggest) { pushIfNotPresent(output.system, sshSuggest); log.debugContext("ssh-suggest", sshSuggest.length) }

    const patterns = getRecurringCorrectionNotices()
    if (patterns) { pushIfNotPresent(output.system, patterns); log.debugContext("patterns", patterns.length) }

    if (isTunnelDegraded()) {
      const msg = `[studio tunnel] DOWN ${getTunnelFailureCount()}x — run studio_tunnel_restart. Remote sync may be interrupted.`
      pushIfNotPresent(output.system, msg)
      log.debugContext("tunnel-degraded", msg.length)
    }

    log.debug("discipline", `Injected ${output.system.length - before} context blocks (total ${output.system.length})`)
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
