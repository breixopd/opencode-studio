import { incompleteTasks, studioPersistentContext } from "./workspace"

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
