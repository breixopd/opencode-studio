/**
 * First-run / chat budget intent — set, clear, or leave default.
 * Used by chat-message hook and tests.
 */
export type BudgetIntent =
  | { kind: "set"; usd: number }
  | { kind: "clear" }
  | null

/**
 * Detect natural-language budget commands.
 * Examples: "budget $5", "session budget 10", "clear budget", "disable budget",
 * "no spend cap", "unlimited budget", "budget off".
 */
export function detectBudgetIntent(text: string): BudgetIntent {
  const t = text.trim()
  if (!t) return null

  if (
    /\b(?:clear|remove|disable|turn\s+off)\s+(?:the\s+)?(?:session\s+)?(?:spend\s+)?(?:cap|budget)\b/i.test(t) ||
    /\b(?:no|without)\s+(?:session\s+)?(?:spend\s+)?(?:cap|budget)\b/i.test(t) ||
    /\b(?:unlimited|disable)\s+budget\b/i.test(t) ||
    /\bbudget\s+(?:off|unlimited|disabled|none|0)\b/i.test(t) ||
    /\bspend\s+cap\s+off\b/i.test(t)
  ) {
    return { kind: "clear" }
  }

  const setMatch = t.match(
    /\b(?:set\s+)?(?:session\s+)?(?:spend\s+)?(?:cap|budget)\s*(?:to\s*)?\$?\s*(\d+(?:\.\d{1,2})?)\b/i,
  )
  if (setMatch) {
    const usd = Number(setMatch[1])
    if (Number.isFinite(usd) && usd > 0) return { kind: "set", usd }
    if (Number.isFinite(usd) && usd === 0) return { kind: "clear" }
  }

  return null
}
