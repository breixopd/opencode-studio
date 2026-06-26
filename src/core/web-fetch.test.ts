import { describe, it, expect } from "bun:test"
import { assertUrlSafe } from "./web-fetch"

describe("web-fetch SSRF", () => {
  it("blocks localhost", async () => {
    await expect(assertUrlSafe("http://localhost/")).rejects.toThrow()
  })

  it("allows public hostnames", async () => {
    await expect(assertUrlSafe("https://example.com/")).resolves.toBeUndefined()
  })
})
