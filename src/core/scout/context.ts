import { incompleteTasks, createTask } from "../workspace-tasks"
import { getAutonomyMode, type AutonomyMode } from "../project-profile"
import * as log from "../logger"
import { getActiveDirectory } from "../active-dir"
import type { ScoutFinding } from "./types"
import { runScout } from "./run"

const SCOUT_TASK_TAG = /^\[scout:([^\]]+)\]\s*/

/** Context block for discipline injection. Null when autonomy is off or nothing found. */
export function scoutContextBlock(root = getActiveDirectory()): string | null {
  const mode = getAutonomyMode()
  if (mode === "off") return null

  const findings = runScout(root, mode === "full" ? 8 : 5)
  if (!findings.length) return null

  const lines = [
    "[studio scout] Autonomous improvement opportunities (opt out: studio_preferences set_autonomy off, or say \"don't scout\"):",
  ]
  for (const f of findings) {
    lines.push(`- [${f.severity}/${f.category}] ${f.title}: ${f.detail}`)
    lines.push(`  → ${f.action}`)
  }
  if (mode === "suggest") {
    lines.push("Mode=suggest: surface these; only act on high severity or when idle unless user asks.")
  } else {
    const created = materializeAutoActTasks(findings)
    if (created.length) {
      lines.push(
        `Mode=full auto-act: created ${created.length} task(s): ${created.map((t) => t.title).join("; ")}`,
      )
    }
    const top = findings.find((f) => f.severity === "high") ?? findings.find((f) => f.severity === "medium")
    if (top) {
      lines.push(
        `Mode=full MANDATORY NEXT (verify-first): @studio-implement — ${top.action} then studio_verify. ` +
          `Do this before new feature work. Ask before large refactors.`,
      )
    } else {
      lines.push("Mode=full: when idle, proactively fix medium/low items (tests+verify first). Ask before large refactors.")
    }
  }
  return lines.join("\n")
}

/**
 * When autonomy=full, turn high (and top medium) findings into studio_tasks
 * so the board + agent both have concrete work — not just prompt text.
 * Idempotent: skips findings that already have an open scout-tagged task.
 */
export function materializeAutoActTasks(findings: ScoutFinding[]): Array<{ id: string; title: string }> {
  const open = incompleteTasks()
  const existingIds = new Set(
    open
      .map((t) => t.title.match(SCOUT_TASK_TAG)?.[1])
      .filter((id): id is string => Boolean(id)),
  )

  const actionable = findings.filter(
    (f) => f.severity === "high" || (f.severity === "medium" && f.category !== "polish"),
  )
  const created: Array<{ id: string; title: string }> = []
  for (const f of actionable.slice(0, 3)) {
    if (existingIds.has(f.id)) continue
    const title = `[scout:${f.id}] ${f.title}`.slice(0, 500)
    const task = createTask(title, [
      f.detail.slice(0, 400),
      `Action: ${f.action}`,
      "Verify-first: implement → studio_verify before handoff",
      `scout-id:${f.id}`,
    ])
    created.push({ id: task.id, title: task.title })
    existingIds.add(f.id)
    log.info(`Auto-act task created: ${task.title}`)
  }
  return created
}

/** Detect natural-language autonomy opt-out / opt-in from user chat. */
export function detectAutonomyIntent(text: string): AutonomyMode | null {
  const t = text.toLowerCase()
  if (
    /\b(don'?t scout|no scout|stop scout|disable scout|no autonomy|turn off autonomy|stop suggesting(?: improvements)?|don'?t (?:be )?proactive|leave me alone)\b/.test(t)
  ) {
    return "off"
  }
  if (/\b(full autonomy|be proactive|autonomy on|enable scout|scout on|autonomous mode)\b/.test(t)) {
    return "full"
  }
  if (/\b(suggest only|suggestions only|autonomy suggest)\b/.test(t)) {
    return "suggest"
  }
  return null
}

/** Format scout findings for the studio_scout tool. */
export function formatScoutReport(findings: ScoutFinding[], mode: AutonomyMode): string {
  if (!findings.length) {
    return `Autonomy=${mode}. No improvement opportunities found right now. Run studio_verify or continue feature work.`
  }
  const lines = [`# Studio Scout (autonomy=${mode})`, ""]
  for (const f of findings) {
    lines.push(`## [${f.severity}] ${f.title}`)
    lines.push(f.detail)
    lines.push(`**Next:** ${f.action}`)
    lines.push("")
  }
  lines.push("Create tasks with studio_task for anything you will act on. Always studio_verify before handoff.")
  return lines.join("\n")
}
