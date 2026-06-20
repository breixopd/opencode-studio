const PARALLEL_HINT =
  "[studio] Parallel mode: spawn multiple subagents NOW via task tool — @studio-explore for code, @studio-research for docs/examples, @studio-implement for code. Do not serialize."

const KEYWORD_HINTS: Array<{ match: RegExp; hint: string }> = [
  { match: /\b(ultrawork|ulw|ultra)\b/i, hint: PARALLEL_HINT },
  {
    match: /\b(start-work|start work)\b/i,
    hint: "[studio] Boulder workflow: research → studio_plan → studio_task → implement → studio_verify → studio_handoff. Use question tool when unsure.",
  },
  {
    match: /\b(plan|@plan)\b/i,
    hint: "[studio] Research docs/examples FIRST, then studio_plan write. Include edge cases and test strategy.",
  },
  {
    match: /\b(review|code review)\b/i,
    hint: "[studio] Delegate to @studio-review. Check API usage vs docs, edge cases, perf, test quality.",
  },
  {
    match: /\b(implement|add feature|build|fix bug|refactor)\b/i,
    hint: "[studio] Before coding: skim official docs + examples (studio_search / @studio-research). No guessing APIs.",
  },
  {
    match: /\b(remote path|sync path|vps path)\b/i,
    hint: "[studio] Default remote: /home/{user}/{project-name}. Save user preference: studio_preferences set_remote_path.",
  },
  {
    match: /\bremember\b/i,
    hint: "[studio] User said 'remember' — this is an important rule. Persist with studio_remember add immediately.",
  },
]

export function createOrchestrationHook() {
  const seen = new Map<string, Set<string>>()

  return async (
    input: { sessionID: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ) => {
    const sessionID = input.sessionID
    if (!seen.has(sessionID)) seen.set(sessionID, new Set())
    const fired = seen.get(sessionID)!

    const text = (output.parts || [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join(" ")

    for (const { match, hint } of KEYWORD_HINTS) {
      const key = match.source
      if (match.test(text) && !fired.has(key)) {
        fired.add(key)
        output.parts.push({ type: "text", text: hint })
      }
    }
  }
}
