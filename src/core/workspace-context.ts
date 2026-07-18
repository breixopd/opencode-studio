/** Workspace session context — blocks injected each turn into the system prompt. */
import { formatPlanAsMarkdown } from "./plan-format"
import { projectContextBlock } from "./project-profile"
import type { VerifyState } from "./workspace-types"
import {
  db, ensureMigrated,
} from "./workspace-base"
import { queryOne } from "./studio-db"
import { listRules, formatRules } from "./workspace-base"
import { getActivePlan } from "./workspace-plans"
import { listBranches, getActiveBranch } from "./workspace-branches"
import { listPinnedContext } from "./workspace-base"
import { incompleteTasks } from "./workspace-tasks"

const MAX_PLAN_CONTEXT_CHARS = 12_000

export function rememberRulesText(): string | null {
  const rules = listRules()
  return rules.length ? formatRules(rules) : null
}

export function activePlanContextBlock(): string | null {
  const plan = getActivePlan()
  const branch = getActiveBranch()
  if (!plan && !branch) return null

  const parts: string[] = ["[studio] Follow the active plan unless the user changes direction."]

  if (plan) {
    let md = formatPlanAsMarkdown(plan)
    if (md.length > MAX_PLAN_CONTEXT_CHARS) {
      md = `${md.slice(0, MAX_PLAN_CONTEXT_CHARS)}\n\n…(truncated — studio_plan read)`
    }
    parts.push(md)
  }

  if (branch?.status === "open") {
    parts.push(`[studio branch] ${branch.title}: ${branch.goal}`)
  }

  const folded = listBranches().filter((b) => b.status === "folded" && b.summary).slice(-3)
  if (folded.length) {
    parts.push("[studio branch] Folded:\n" + folded.map((b) => `- ${b.title}: ${b.summary}`).join("\n"))
  }

  return parts.join("\n\n")
}

export function studioPersistentContext(): string[] {
  return [...studioStableContext(), ...studioDynamicContext()]
}

export function studioStableContext(): string[] {
  const blocks: string[] = []
  const project = projectContextBlock()
  if (project) blocks.push(project)
  const remember = rememberRulesText()
  if (remember) blocks.push(`[studio remember] Project rules:\n${remember}`)
  return blocks
}

export function studioDynamicContext(): string[] {
  const blocks: string[] = []
  const plan = activePlanContextBlock()
  if (plan) blocks.push(plan)
  const pinned = listPinnedContext()
  if (pinned.length) {
    blocks.push("[studio context] Pinned (survives compaction):\n" + pinned.map((p, i) => `${i + 1}. ${p}`).join("\n"))
  }
  const verify = getVerifyStateSafe()
  if (verify && !verify.passed) {
    blocks.push("[studio verify] Last run FAILED — fix issues and re-run studio_verify before handoff.")
  }
  return blocks
}

/** Inline verify state read (avoids circular import with workspace-verify). */
function getVerifyStateSafe(): VerifyState | undefined {
  ensureMigrated()
  const row = queryOne<{ passed: number; at: string; commands: string }>(
    db(), "SELECT * FROM verify_state WHERE id = 1",
  )
  if (!row || !row.at) return undefined
  return { passed: row.passed === 1, at: row.at, commands: row.commands ? row.commands.split("\n").filter((l) => l.length > 0) : [] }
}

export function studioContextBlocks(): string[] {
  return studioPersistentContext()
}

export function openTasksSystemBlock(): string | null {
  const open = incompleteTasks()
  if (open.length === 0) return null
  const lines = open.map((t) => `- [${t.status}] ${t.id}: ${t.title}`).join("\n")
  return `[studio tasks] Finish ALL before done:\n${lines}\nstudio_task done for each; studio_verify before handoff.`
}

export function openTasksCompactionBlock(): string | null {
  const open = incompleteTasks()
  if (open.length === 0) return null
  return `Open tasks: ${open.map((t) => t.title).join("; ")}. Resume after compaction.`
}
