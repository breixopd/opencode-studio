/**
 * Token optimization helpers.
 *
 * 1. tokenEst — cheap heuristic (~4 chars/token, like Probe/others)
 * 2. truncateToTokenBudget — cap any text by estimated tokens
 * 3. dedupeByContentHash — skip identical tool outputs across a session
 * 4. compactToolOutput — strip consecutive blank lines, leading indentation
 *
 * Goal: every tool that returns code to the LLM should pass through truncateToTokenBudget.
 */
import { createHash } from "crypto"

const CHARS_PER_TOKEN = 4
const DEFAULT_BUDGET = 8000

export function tokenEst(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Cap text to an estimated token budget. Keeps a tail marker when truncated. */
export function truncateToTokenBudget(text: string, budget = DEFAULT_BUDGET): string {
  const max = budget * CHARS_PER_TOKEN
  if (text.length <= max) return text
  return text.slice(0, max) + "\n… [truncated to fit token budget]"
}

/** Collapse consecutive blank lines and trim trailing whitespace per line. */
export function compactToolOutput(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Deduplicate tool outputs by content hash within a session. */
export class OutputDeduplicator {
  private seen = new Set<string>()

  /** Returns true if this exact output was already seen in this session. */
  isDuplicate(text: string): boolean {
    const key = createHash("sha1").update(text).digest("hex").slice(0, 16)
    if (this.seen.has(key)) return true
    this.seen.add(key)
    return false
  }

  /** If duplicate, returns empty string; otherwise returns the (optionally compacted) text. */
  filter(text: string, opts?: { compact?: boolean }): string {
    if (this.isDuplicate(text)) return ""
    return opts?.compact ? compactToolOutput(text) : text
  }

  reset(): void {
    this.seen.clear()
  }
}

/**
 * Apply all the standard transforms: dedupe, compact, truncate to budget.
 * Used as the final pass before any tool output is returned to the LLM.
 */
export function optimizeToolOutput(
  text: string,
  deduper: OutputDeduplicator,
  opts?: { budget?: number; compact?: boolean },
): string {
  const filtered = deduper.filter(text, { compact: opts?.compact ?? true })
  if (!filtered) return "[output identical to previous — skipped]"
  return truncateToTokenBudget(filtered, opts?.budget ?? DEFAULT_BUDGET)
}
