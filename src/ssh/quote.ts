/** ponytail: one-liner shell quoting — no dependency */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}