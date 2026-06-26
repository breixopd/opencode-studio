/** Workspace memory search — searches rules, plans, handoffs, branches. */
import { queryAll } from "./studio-db"
import { db, ensureMigrated } from "./workspace-base"

export interface MemoryHit {
  kind: "rule" | "plan" | "handoff" | "branch"
  id: string
  title: string
  snippet: string
}

export function searchMemory(query: string, limit = 12): MemoryHit[] {
  ensureMigrated()
  const d = db()
  const q = `%${query.toLowerCase()}%`
  const hits: MemoryHit[] = []

  const rules = queryAll<{ rule: string }>(d, "SELECT rule FROM rules WHERE LOWER(rule) LIKE ? LIMIT ?", [q, limit])
  for (const r of rules) hits.push({ kind: "rule", id: "rule", title: "User rule", snippet: r.rule })

  const plans = queryAll<{ id: string; title: string; goal: string }>(
    d, "SELECT id, title, goal FROM plans WHERE LOWER(title) LIKE ? OR LOWER(goal) LIKE ? LIMIT ?", [q, q, limit],
  )
  for (const p of plans) hits.push({ kind: "plan", id: p.id, title: p.title, snippet: p.goal.slice(0, 160) })

  const handoffs = queryAll<{ id: string; summary: string }>(
    d, "SELECT id, summary FROM handoffs WHERE LOWER(summary) LIKE ? LIMIT ?", [q, limit],
  )
  for (const h of handoffs) hits.push({ kind: "handoff", id: h.id, title: h.summary.slice(0, 60), snippet: h.summary.slice(0, 160) })

  const branches = queryAll<{ id: string; title: string; summary: string }>(
    d, "SELECT id, title, summary FROM branches WHERE status = 'folded' AND (LOWER(title) LIKE ? OR LOWER(summary) LIKE ?) LIMIT ?", [q, q, limit],
  )
  for (const b of branches) hits.push({ kind: "branch", id: b.id, title: b.title, snippet: b.summary?.slice(0, 160) ?? "" })

  return hits.slice(0, limit)
}
