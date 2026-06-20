import { incompleteTasks } from "../core/tasks"
import { studioPersistentContext } from "../core/session-context"

export function createCompactionHook() {
  return async (
    _input: { sessionID: string },
    output: { context: string[] },
  ) => {
    for (const block of studioPersistentContext()) {
      output.context.push(block)
    }

    const open = incompleteTasks()
    if (open.length > 0) {
      output.context.push(
        `Open studio tasks: ${open.map((t) => t.title).join("; ")}. Resume after compaction.`,
      )
    }
  }
}
