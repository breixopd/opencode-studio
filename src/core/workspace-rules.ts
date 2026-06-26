/** Workspace rules — project-scoped user rules with dedup. */
import { runQuery, queryAll } from "./studio-db"
import { db, ensureMigrated, now } from "./workspace-base"

export function listRules(): string[] {
  ensureMigrated()
  const rows = queryAll<{ rule: string }>(db(), "SELECT rule FROM rules ORDER BY id")
  return rows.map((r) => r.rule)
}

export function addRule(rule: string): string[] {
  ensureMigrated()
  const trimmed = rule.trim()
  if (!trimmed) throw new Error("Rule must not be empty")
  runQuery(db(), "INSERT OR IGNORE INTO rules (rule, created_at) VALUES (?, ?)", [trimmed, now()])
  return listRules()
}

export function removeRule(rule: string): string[] {
  ensureMigrated()
  runQuery(db(), "DELETE FROM rules WHERE rule = ?", [rule.trim()])
  return listRules()
}

export function formatRules(rules: string[]): string {
  return rules.map((r) => `- ${r}`).join("\n")
}
