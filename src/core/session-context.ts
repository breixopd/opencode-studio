import { rememberRulesText } from "./remember"
import { activePlanContextBlock } from "./plan-context"

/** Shared context blocks for discipline + compaction hooks. */
export function studioPersistentContext(): string[] {
  const blocks: string[] = []

  const remember = rememberRulesText()
  if (remember) {
    blocks.push(
      `[studio remember] User rules — follow unless they say otherwise:\n${remember}`,
    )
  }

  const plan = activePlanContextBlock()
  if (plan) blocks.push(plan)

  return blocks
}
