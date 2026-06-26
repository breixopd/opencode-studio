import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { canHandoff, getActiveTasks } from "../core/workspace"
import * as log from "../core/logger"

/**
 * Tool guards — pre-execution checks that prevent common mistakes.
 *
 * 1. studio_handoff: blocked until all tasks done + verify passes (force:true overrides)
 * 2. studio_verify: TDD gate — warns (not blocks) if no test file exists for the active task
 */
export function createToolGuardsHook() {
  return async (input: { tool: string }, output: { args: Record<string, unknown> }) => {
    if (input.tool === "studio_handoff") {
      const gate = canHandoff(output.args?.force === true)
      if (!gate.ok) {
        throw new Error(
          `Handoff blocked: ${gate.reason}. Run studio_verify first or pass force:true to override.`,
        )
      }
    }

    // Tier S #4 — TDD gate: checks if a test file exists for the active task.
    // Warns (via console) but doesn't block — the agent still runs verify,
    // it just knows it should write tests first. This is the "50-line feature
    // no competitor has" from the ROADMAP.
    if (input.tool === "studio_verify" && !output.args?.force) {
      const tasks = getActiveTasks()
      if (tasks.length === 0) return
      const task = tasks.find((t) => t.status === "in_progress") ?? tasks[0]
      if (!task) return

      const testExists = findTestForTask(task.title, process.cwd())
      if (!testExists) {
        log.warn(
          `TDD gate: no test file found for active task '${task.title}'. Consider writing a test first (TDD), then re-run studio_verify.`,
        )
      }
    }
  }
}

/**
 * Heuristic: search for a test file whose name contains a keyword from the task title.
 * Looks for *.test.ts, *.test.tsx, *.spec.ts, *.spec.tsx, *_test.go, test_*.py etc.
 */
function findTestForTask(taskTitle: string, cwd: string): boolean {
  const keyword = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20)
  if (keyword.length < 3) return true // too generic to check — don't warn

  const testDirs = ["test", "tests", "__tests__", "spec", "specs", "."]
  const testPatterns = [
    (name: string) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"),
    (name: string) => name.endsWith(".spec.ts") || name.endsWith(".spec.tsx"),
    (name: string) => name.endsWith("_test.go") || name.endsWith("_test.rs"),
    (name: string) => name.startsWith("test_") && (name.endsWith(".py") || name.endsWith(".pyi")),
  ]

  for (const dir of testDirs) {
    const abs = dir === "." ? cwd : join(cwd, dir)
    if (!existsSync(abs)) continue
    let entries: string[]
    try {
      entries = readdirSync(abs)
    } catch {
      continue
    }
    for (const name of entries) {
      if (testPatterns.some((p) => p(name))) {
        const nameLower = name.toLowerCase()
        if (nameLower.includes(keyword.slice(0, 8))) return true
      }
    }
  }
  return false
}
