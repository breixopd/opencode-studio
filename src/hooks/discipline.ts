import { STUDIO_DISCIPLINE } from "../core/discipline"
import { incompleteTasks } from "../core/tasks"
import { studioPersistentContext } from "../core/session-context"

export function createDisciplineSystemHook() {
  return async (
    _input: { sessionID?: string },
    output: { system: string[] },
  ) => {
    if (!output.system.includes(STUDIO_DISCIPLINE)) {
      output.system.push(STUDIO_DISCIPLINE)
    }

    for (const block of studioPersistentContext()) {
      if (!output.system.some((s) => s.includes(block.slice(0, 40)))) {
        output.system.push(block)
      }
    }

    const open = incompleteTasks()
    if (open.length > 0) {
      const lines = open.map((t) => `- [${t.status}] ${t.id}: ${t.title}`).join("\n")
      output.system.push(
        `[studio boulder] Incomplete tasks — finish ALL before claiming done:\n${lines}\nUse studio_task action=done for each. Run studio_verify before handoff.`,
      )
    }
  }
}
