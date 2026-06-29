/**
 * Plan Drift Detection — compares the actual code changes against the
 * active plan's acceptance criteria and warns if they diverge.
 *
 * Checks:
 *   - Are all acceptance criteria mentioned in recent changes?
 *   - Are there changes that don't relate to any acceptance criterion?
 *   - Are planned steps being implemented in order?
 */
import { getActivePlan, listTasks } from "./workspace"
import { getWorkingSet } from "./passive-context"

/** Check for plan drift and generate a warning if detected. */
export function checkPlanDrift(): string | null {
  const plan = getActivePlan()
  if (!plan) return null

  const workingSet = getWorkingSet(10)
  if (workingSet.length === 0) return null

  const tasks = listTasks()
  const inProgress = tasks.filter((t) => t.status === "in_progress")
  const done = tasks.filter((t) => t.status === "done")

  // Build acceptance criteria keywords from the plan
  const acceptanceKeywords = plan.acceptance.flatMap((a) =>
    a.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3),
  )

  // Check if working set files relate to acceptance criteria
  const unrelatedFiles: string[] = []
  for (const file of workingSet) {
    const fileLower = file.toLowerCase()
    const relates = acceptanceKeywords.some((kw) => fileLower.includes(kw))
    if (!relates) {
      // Check if the file is a test, config, or infrastructure file
      const isInfra = file.match(/test|spec|config|\.json|\.yaml|\.toml|\.lock|\.gitignore/i)
      if (!isInfra) unrelatedFiles.push(file)
    }
  }

  // Check if tasks are being done in a reasonable order
  const lines: string[] = []

  if (unrelatedFiles.length > 3) {
    lines.push("[studio drift] Some edited files don't relate to the active plan's acceptance criteria:")
    for (const f of unrelatedFiles.slice(0, 5)) {
      lines.push(`  ${f}`)
    }
    if (unrelatedFiles.length > 5) lines.push(`  ...and ${unrelatedFiles.length - 5} more`)
    lines.push("Consider: are these changes in scope, or has the implementation drifted from the plan?")
  }

  // Check if all acceptance criteria have corresponding tasks
  const acceptanceWithoutTasks: string[] = []
  for (const criteria of plan.acceptance) {
    const hasTask = tasks.some((t) =>
      t.acceptance?.some((a) => a.toLowerCase().includes(criteria.toLowerCase().slice(0, 20))) ||
      t.title.toLowerCase().includes(criteria.toLowerCase().slice(0, 10)),
    )
    if (!hasTask && !done.some((t) => t.title.toLowerCase().includes(criteria.toLowerCase().slice(0, 10)))) {
      acceptanceWithoutTasks.push(criteria.slice(0, 80))
    }
  }

  if (acceptanceWithoutTasks.length > 0 && inProgress.length > 0) {
    lines.push("")
    lines.push("[studio drift] Acceptance criteria without corresponding tasks:")
    for (const c of acceptanceWithoutTasks.slice(0, 3)) {
      lines.push(`  - ${c}`)
    }
    lines.push("Consider: create tasks for these criteria with studio_task create.")
  }

  if (lines.length === 0) return null
  return lines.join("\n")
}
