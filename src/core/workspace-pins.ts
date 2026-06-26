/** Workspace pinned context — blocks that survive compaction. */
import { runQuery, queryOne, queryAll } from "./studio-db"
import { db, ensureMigrated, now } from "./workspace-base"

const MAX_PINNED_BLOCKS = 50
const MAX_PIN_BLOCK_CHARS = 8000

export function listPinnedContext(): string[] {
  ensureMigrated()
  const rows = queryAll<{ block: string }>(db(), "SELECT block FROM pinned_context ORDER BY id")
  return rows.map((r) => r.block)
}

export function pinContext(block: string): string[] {
  ensureMigrated()
  const trimmed = block.trim().slice(0, MAX_PIN_BLOCK_CHARS)
  if (!trimmed) throw new Error("Context block must not be empty")
  const d = db()
  d.transaction(() => {
    const count = (queryOne<{ c: number }>(d, "SELECT COUNT(*) AS c FROM pinned_context") ?? { c: 0 }).c
    if (count >= MAX_PINNED_BLOCKS) {
      runQuery(d, "DELETE FROM pinned_context WHERE id = (SELECT MIN(id) FROM pinned_context)")
    }
    runQuery(d, "INSERT INTO pinned_context (block, pinned_at) VALUES (?, ?)", [trimmed, now()])
  })()
  return listPinnedContext()
}

export function unpinContext(index: number): string[] {
  ensureMigrated()
  if (index < 0) throw new Error(`Invalid pin index: ${index}`)
  const rows = queryAll<{ id: number }>(db(), "SELECT id FROM pinned_context ORDER BY id")
  if (index >= rows.length) throw new Error(`Invalid pin index: ${index}`)
  runQuery(db(), "DELETE FROM pinned_context WHERE id = ?", [rows[index].id])
  return listPinnedContext()
}

export function clearPinnedContext(): void {
  ensureMigrated()
  runQuery(db(), "DELETE FROM pinned_context")
}
