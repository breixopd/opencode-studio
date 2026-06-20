import { describe, it, expect, afterEach } from "bun:test"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { compressToolOutput, retrieveCached } from "./compress"

const ROOT = join(process.cwd(), ".studio")

afterEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

describe("compressToolOutput", () => {
  it("passes through small output", () => {
    const r = compressToolOutput("hello")
    expect(r.cached).toBe(false)
    expect(r.text).toBe("hello")
  })

  it("compresses large JSON arrays", () => {
    const big = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, ok: true })))
    const r = compressToolOutput(big)
    expect(r.cached).toBe(true)
    expect(r.text).toContain("_studio_compressed")
    expect(r.id).toBeDefined()
    const full = retrieveCached(r.id!)
    expect(full.length).toBe(big.length)
  })
})
