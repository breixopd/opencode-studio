import { incompleteTasks, getVerifyState } from "../core/workspace"
import { MAX_VERIFY_GRIND } from "../core/workspace-verify"

export { MAX_VERIFY_GRIND }

export function compactionContinuePrompt(): string | null {
  const open = incompleteTasks()
  const verify = getVerifyState()

  if (open.length) {
    return `Continue: complete open tasks (${open.map((t) => t.title).join(", ")}), then studio_verify.`
  }

  if (verify && !verify.passed) {
    return "Continue: studio_verify failed — fix issues, re-run studio_verify, then studio_handoff."
  }

  return null
}

export function createCompactionContinueHook() {
  return async (
    _input: { sessionID: string },
    output: { enabled: boolean },
  ) => {
    if (compactionContinuePrompt()) output.enabled = true
  }
}
