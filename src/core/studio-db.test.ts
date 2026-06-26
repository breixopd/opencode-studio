import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  studioDbPath,
  openStudioDb,
  closeStudioDb,
  queryAll,
  queryOne,
  runQuery,
  SCHEMA_VERSION,
} from "./studio-db"

describe("studio-db", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-db-"))
  })

  afterEach(() => {
    closeStudioDb(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  it("studioDbPath returns correct path", () => {
    const path = studioDbPath(dir)
    expect(path).toBe(join(dir, ".studio", "studio.db"))
  })

  it("openStudioDb creates the database file", () => {
    const db = openStudioDb(dir)
    expect(db).toBeDefined()
    expect(existsSync(studioDbPath(dir))).toBe(true)
  })

  it("openStudioDb returns cached connection on second call", () => {
    const db1 = openStudioDb(dir)
    const db2 = openStudioDb(dir)
    expect(db1).toBe(db2) // same object reference
  })

  it("SCHEMA_VERSION is set", () => {
    expect(SCHEMA_VERSION).toBeDefined()
    expect(typeof SCHEMA_VERSION).toBe("string")
  })

  it("creates all required tables", () => {
    const db = openStudioDb(dir)
    const tables = queryAll<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain("files")
    expect(tableNames).toContain("symbols")
    expect(tableNames).toContain("chunks")
    expect(tableNames).toContain("edges")
    expect(tableNames).toContain("imports")
    expect(tableNames).toContain("plans")
    expect(tableNames).toContain("tasks")
    expect(tableNames).toContain("rules")
    expect(tableNames).toContain("branches")
    expect(tableNames).toContain("handoffs")
    expect(tableNames).toContain("pinned_context")
    expect(tableNames).toContain("verify_state")
    expect(tableNames).toContain("cost_events")
    expect(tableNames).toContain("diagnostics")
    expect(tableNames).toContain("meta")
    expect(tableNames).toContain("fts_chunks")
  })

  it("creates FTS5 virtual table and triggers", () => {
    const db = openStudioDb(dir)
    const vtables = queryAll<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fts_%'",
    )
    expect(vtables.length).toBeGreaterThan(0)
    expect(vtables[0]!.name).toBe("fts_chunks")

    const triggers = queryAll<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
    )
    const triggerNames = triggers.map((t) => t.name)
    expect(triggerNames).toContain("chunks_ai")
    expect(triggerNames).toContain("chunks_ad")
    expect(triggerNames).toContain("chunks_au")
  })

  it("creates unique index on cost_events.message_id", () => {
    const db = openStudioDb(dir)
    const indexes = queryAll<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_cost_%'",
    )
    const indexNames = indexes.map((i) => i.name)
    expect(indexNames).toContain("idx_cost_message")
  })

  it("runQuery + queryAll round-trip works", () => {
    const db = openStudioDb(dir)
    runQuery(db, "INSERT INTO rules (rule, created_at) VALUES (?, ?)", ["test rule", "2024-01-01"])
    const rows = queryAll<{ rule: string }>(db, "SELECT rule FROM rules")
    expect(rows.length).toBe(1)
    expect(rows[0]!.rule).toBe("test rule")
  })

  it("queryOne returns single row or null", () => {
    const db = openStudioDb(dir)
    const empty = queryOne<{ rule: string }>(db, "SELECT rule FROM rules LIMIT 1")
    expect(empty).toBeNull()

    runQuery(db, "INSERT INTO rules (rule, created_at) VALUES (?, ?)", ["find me", "2024-01-01"])
    const found = queryOne<{ rule: string }>(db, "SELECT rule FROM rules LIMIT 1")
    expect(found).not.toBeNull()
    expect(found!.rule).toBe("find me")
  })

  it("cost_events enforces unique on message_id", () => {
    const db = openStudioDb(dir)
    runQuery(db, "INSERT INTO cost_events (session_id, message_id, provider_id, model_id, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["sess1", "msg1", "anthropic", "claude", 0.01, Date.now()])
    // Second insert with same message_id should be ignored
    runQuery(db, "INSERT OR IGNORE INTO cost_events (session_id, message_id, provider_id, model_id, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["sess1", "msg1", "anthropic", "claude", 0.02, Date.now()])
    const count = queryOne<{ c: number }>(db, "SELECT COUNT(*) AS c FROM cost_events")
    expect(count!.c).toBe(1)
  })

  it("closeStudioDb removes the connection from cache", () => {
    openStudioDb(dir)
    closeStudioDb(dir)
    // Opening again should create a new connection (different object)
    const db1 = openStudioDb(dir)
    closeStudioDb(dir)
    const db2 = openStudioDb(dir)
    expect(db1).not.toBe(db2)
    closeStudioDb(dir)
  })
})
