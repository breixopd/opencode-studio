import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { clearActiveDirectory, setActiveDirectory } from "./active-dir"
import { closeStudioDb } from "./studio-db"
import {
  saveMemory,
  readMemoryIndex,
  readMemoryTopic,
  listMemoryTopics,
  hasSimilarMemory,
  routeScope,
  recordCorrection,
  getRecurringPatterns,
  memoryContextBlock,
} from "./auto-memory"

describe("auto-memory", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-mem-"))
    setActiveDirectory(dir)
  })

  afterEach(() => {
    closeStudioDb(dir)
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
  })

  it("saves a memory entry to topic file and index", () => {
    saveMemory({
      topic: "debugging",
      content: "Empty array returned when db is locked",
      source: "agent",
      createdAt: new Date().toISOString(),
    })

    const index = readMemoryIndex()
    expect(index).toContain("Empty array returned when db is locked")
    expect(index).toContain("[debugging]")

    const topic = readMemoryTopic("debugging")
    expect(topic).toContain("Empty array returned when db is locked")
    expect(topic).toContain("**Source:** agent")
  })

  it("reads a non-existent topic returns null", () => {
    const result = readMemoryTopic("architecture")
    expect(result).toBeNull()
  })

  it("lists only topics that have files", () => {
    saveMemory({ topic: "conventions", content: "Use 2-space indent", source: "agent", createdAt: new Date().toISOString() })
    const topics = listMemoryTopics()
    expect(topics.length).toBe(1)
    expect(topics[0].topic).toBe("conventions")
  })

  it("detects similar memory (dedup)", () => {
    saveMemory({ topic: "conventions", content: "Always use pnpm, not npm", source: "agent", createdAt: new Date().toISOString() })
    expect(hasSimilarMemory("always use pnpm, not npm", "conventions")).toBe(true)
    expect(hasSimilarMemory("completely different content", "conventions")).toBe(false)
  })

  it("returns null context block when no memories exist", () => {
    const block = memoryContextBlock()
    expect(block).toBeNull()
  })

  it("generates context block with index and topics", () => {
    saveMemory({ topic: "build-commands", content: "Run bun test --watch for TDD", source: "agent", createdAt: new Date().toISOString() })
    const block = memoryContextBlock()
    expect(block).not.toBeNull()
    expect(block!).toContain("[studio memory]")
    expect(block!).toContain("build-commands")
  })
})

describe("routeScope", () => {
  it("routes to global for general coding philosophy", () => {
    expect(routeScope("Always write tests first")).toBe("global")
    expect(routeScope("Never commit directly to main")).toBe("global")
    expect(routeScope("Prefer functional style over OOP")).toBe("global")
  })

  it("routes to project for project-specific mentions", () => {
    expect(routeScope("Don't use npm, use pnpm in this repo")).toBe("project")
    expect(routeScope("The database migration needs src/lib/migrate.ts")).toBe("project")
    expect(routeScope("This API requires a local Redis instance")).toBe("project")
  })

  it("defaults to project for ambiguous content", () => {
    expect(routeScope("Use descriptive variable names everywhere")).toBe("project")
  })
})

describe("correction patterns", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-pat-"))
    setActiveDirectory(dir)
  })

  afterEach(() => {
    closeStudioDb(dir)
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
  })

  it("records first correction as non-recurring", () => {
    const result = recordCorrection("Don't use var, use let", "project")
    expect(result.isRecurring).toBe(false)
    expect(result.count).toBe(1)
  })

  it("detects recurring pattern after 3 corrections", () => {
    recordCorrection("Don't use var, use let", "project")
    recordCorrection("Don't use var, use let", "project")
    const result = recordCorrection("Don't use var, use let", "project")
    expect(result.isRecurring).toBe(true)
    expect(result.count).toBe(3)
    expect(result.suggestion).toContain("permanent")
  })

  it("getRecurringPatterns returns patterns with count >= 3", () => {
    for (let i = 0; i < 3; i++) {
      recordCorrection("Never commit without tests", "global")
    }
    const patterns = getRecurringPatterns()
    expect(patterns).not.toBeNull()
    expect(patterns!.length).toBe(1)
    expect(patterns![0].count).toBe(3)
    expect(patterns![0].scope).toBe("global")
  })

  it("getRecurringPatterns returns null when no patterns", () => {
    const patterns = getRecurringPatterns()
    expect(patterns).toBeNull()
  })
})
