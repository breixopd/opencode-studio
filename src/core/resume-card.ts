/**
 * Cross-session resume card — synthesized on session start to give the agent
 * an immediate "continue where you left off" context block.
 *
 * Combines: last handoff next_steps + incomplete tasks + current git branch +
 * last verify state + recent pinned context.
 */
import { currentBranch } from "./branch-context"
import { getVerifyState, incompleteTasks, listHandoffs, listPinnedContext, getActivePlan } from "./workspace"
import { loadProjectProfile } from "./project-profile"

/** Generate a resume card for injection into the session context. */
export function resumeCard(root: string): string | null {
  const parts: string[] = ["[studio resume] Continue where you left off:"]

  // Current branch
  const branch = currentBranch(root)
  parts.push(`- Git branch: ${branch}`)

  // Active plan
  const plan = getActivePlan()
  if (plan) {
    parts.push(`- Active plan: ${plan.title}`)
  } else {
    parts.push("- No active plan — use studio_spec or studio_plan to create one")
  }

  // Open tasks
  const tasks = incompleteTasks()
  if (tasks.length > 0) {
    const inProgress = tasks.filter((t) => t.status === "in_progress")
    if (inProgress.length > 0) {
      parts.push(`- In progress: ${inProgress.map((t) => t.title).join(", ")}`)
    }
    const pending = tasks.filter((t) => t.status === "pending")
    if (pending.length > 0) {
      parts.push(`- Pending: ${pending.length} task(s) — studio_task list`)
    }
  } else {
    parts.push("- All tasks done or no tasks yet")
  }

  // Last handoff
  const handoffs = listHandoffs()
  if (handoffs.length > 0) {
    const last = handoffs[0]
    if (last.nextSteps) {
      parts.push(`- Last handoff suggested: ${last.nextSteps.slice(0, 200)}`)
    }
  }

  // Verify state
  const verify = getVerifyState()
  if (verify && !verify.passed) {
    parts.push(`- ⚠ Verify FAILED last run — fix issues and re-run studio_verify before handoff`)
  } else if (verify?.passed) {
    parts.push(`- Verify passed — studio_handoff is available`)
  }

  // Pinned context (top 3)
  const pinned = listPinnedContext().slice(0, 3)
  if (pinned.length > 0) {
    parts.push(`- Pinned context: ${pinned.length} block(s) — studio_context list`)
  }

  // Profile summary
  const profile = loadProjectProfile()
  if (profile.summary) {
    parts.push(`- Project: ${profile.summary.slice(0, 100)}`)
  }

  return parts.join("\n")
}
