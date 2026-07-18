/** Keyword that triggers the council from a chat prompt (no slash needed). */
export const COUNCIL_KEYWORD = "council:"

/** Check if a prompt contains the council keyword. */
export function isCouncilTriggered(prompt: string): boolean {
  return prompt.toLowerCase().includes(COUNCIL_KEYWORD)
}
