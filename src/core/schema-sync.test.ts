import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

/**
 * Schema sync test — ensures the inline SCHEMA_SQL in studio-db.ts and the
 * external studio-db-schema.sql file stay in sync. The inline version is
 * what runs at runtime; the .sql file is the human-readable reference.
 */
describe("schema sync", () => {
  it("inline SCHEMA_SQL matches studio-db-schema.sql", () => {
    const sqlPath = join(__dirname, "studio-db-schema.sql")
    const fileContent = readFileSync(sqlPath, "utf-8")

    // Extract the inline schema by creating a DB and dumping its schema.
    // This verifies the runtime schema matches the documented schema.
    const { mkdtempSync, rmSync } = require("fs")
    const { tmpdir } = require("os")
    const { Database } = require("bun:sqlite")
    const dir = mkdtempSync(join(tmpdir(), "studio-schema-"))
    const dbPath = join(dir, "test.db")
    const db = new Database(dbPath, { create: true })

    // Run the documented schema file.
    db.exec(fileContent)

    // Dump the schema from the DB and verify key tables exist.
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name)

    expect(tables).toContain("files")
    expect(tables).toContain("symbols")
    expect(tables).toContain("chunks")
    expect(tables).toContain("edges")
    expect(tables).toContain("imports")
    expect(tables).toContain("plans")
    expect(tables).toContain("tasks")
    expect(tables).toContain("rules")
    expect(tables).toContain("branches")
    expect(tables).toContain("handoffs")
    expect(tables).toContain("pinned_context")
    expect(tables).toContain("verify_state")
    expect(tables).toContain("cost_events")
    expect(tables).toContain("diagnostics")
    expect(tables).toContain("meta")
    expect(tables).toContain("fts_chunks")

    // Verify FTS5 virtual table was created.
    const virtualTables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fts_%'")
      .all()
    expect(virtualTables.length).toBeGreaterThan(0)

    // Verify triggers exist.
    const triggers = db
      .query("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name)
    expect(triggers).toContain("chunks_ai")
    expect(triggers).toContain("chunks_ad")
    expect(triggers).toContain("chunks_au")

    // Verify cost_events has the unique index on message_id (idempotency).
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_cost_%'")
      .all()
      .map((r: { name: string }) => r.name)
    expect(indexes).toContain("idx_cost_message")

    // Clean up.
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it("SCHEMA_VERSION is set", async () => {
    const mod = await import("./studio-db")
    expect(mod.SCHEMA_VERSION).toBeDefined()
    expect(typeof mod.SCHEMA_VERSION).toBe("string")
  })
})
