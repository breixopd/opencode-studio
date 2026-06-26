import { describe, it, expect, afterEach } from "bun:test"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { compressToolOutput, retrieveCached } from "./compress"

const ROOT = join(process.cwd(), ".studio")

afterEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

describe("compressToolOutput", () => {
  it("passes through small output", async () => {
    const r = await compressToolOutput("hello")
    expect(r.cached).toBe(false)
    expect(r.text).toBe("hello")
  })

  it("compresses large output with cache", async () => {
    const big = "x".repeat(5_000)
    const r = await compressToolOutput(big)
    expect(r.cached).toBe(true)
    expect(r.text).toContain("chars omitted")
    expect(r.id).toBeDefined()
    expect(retrieveCached(r.id!).length).toBe(big.length)
  })
})

describe("retrieveCached path traversal guard", () => {
  it("rejects path traversal via ..", () => {
    expect(() => retrieveCached("../../etc/passwd")).toThrow("Invalid cache id")
  })

  it("rejects uppercase hex", () => {
    expect(() => retrieveCached("ABCDEF12")).toThrow("Invalid cache id")
  })

  it("rejects too-short id (7 chars)", () => {
    expect(() => retrieveCached("abcdef1")).toThrow("Invalid cache id")
  })

  it("rejects too-long id (9 chars)", () => {
    expect(() => retrieveCached("abcdef123")).toThrow("Invalid cache id")
  })

  it("rejects empty string", () => {
    expect(() => retrieveCached("")).toThrow("Invalid cache id")
  })

  it("rejects non-hex characters", () => {
    expect(() => retrieveCached("gggggggg")).toThrow("Invalid cache id")
  })

  it("accepts valid 8-char hex id", async () => {
    const r = await compressToolOutput("x".repeat(5_000))
    expect(() => retrieveCached(r.id!)).not.toThrow()
  })
})
