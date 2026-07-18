import { describe, it, expect, afterEach, beforeEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  ftsSimilarChunks,
  getSemanticRecallStatus,
  resetSqliteVecCache,
  similarChunks,
  tokenOverlapScore,
  tokenizeForOverlap,
} from "./semantic-recall"
import { setSemanticRecall, getSemanticRecall } from "./project-profile"
import { buildCodeIndexSqlite } from "./code-store"
import { closeStudioDb } from "./studio-db"

describe("semantic-recall", () => {
  let root: string
  let prevRecall: boolean

  beforeEach(() => {
    prevRecall = getSemanticRecall()
    resetSqliteVecCache()
  })

  afterEach(() => {
    setSemanticRecall(prevRecall)
    if (root) {
      closeStudioDb(root)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("tokenizes and scores overlap", () => {
    expect(tokenizeForOverlap("auth_login_handler")).toEqual(["auth", "login", "handler"])
    const tokens = tokenizeForOverlap("auth login handler")
    expect(tokenOverlapScore(tokens, "auth login flow handler")).toBe(1)
    expect(tokenOverlapScore(tokens, "unrelated text")).toBe(0)
  })

  it("status is off when preference disabled", () => {
    setSemanticRecall(false)
    expect(getSemanticRecallStatus()).toBe("off")
  })

  it("similarChunks returns [] when preference off", () => {
    setSemanticRecall(false)
    root = mkdtempSync(join(tmpdir(), "studio-sr-"))
    expect(similarChunks(root, "authenticate", 5)).toEqual([])
  })

  it("FTS fallback finds overlapping chunks when enabled", async () => {
    setSemanticRecall(true)
    root = mkdtempSync(join(tmpdir(), "studio-sr-"))
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src", "auth.py"), "def authenticate_user(token):\n    return token\n")
    writeFileSync(join(root, "src", "other.py"), "def unrelated():\n    return 1\n")
    await buildCodeIndexSqlite(root, { force: true })
    expect(getSemanticRecallStatus(root)).toBe("fts-fallback")
    const hits = ftsSimilarChunks(root, "authenticate user", 10)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].file).toContain("auth")
    expect(hits[0].backend).toBe("fts-fallback")
    expect(hits[0].score).toBeGreaterThan(0)
  })
})
