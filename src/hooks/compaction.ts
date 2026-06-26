import { openTasksCompactionBlock, studioContextBlocks } from "../core/workspace-context"
import { compactionContinuePrompt } from "./compaction-continue"

export function createCompactionHook() {
  return async (
    _input: { sessionID: string },
    output: { context: string[] },
  ) => {
    output.context.push(...studioContextBlocks())

    const tasks = openTasksCompactionBlock()
    if (tasks) output.context.push(tasks)

    const cont = compactionContinuePrompt()
    if (cont) output.context.push(`[studio continue] ${cont}`)
  }
}
