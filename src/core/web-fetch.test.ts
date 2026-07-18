import { describe, it, expect } from "bun:test"
import { assertUrlSafe, isPrivateOrLocalAddress } from "./web-fetch"

describe("web-fetch SSRF", () => {
  it("blocks localhost", async () => {
    await expect(assertUrlSafe("http://localhost/")).rejects.toThrow()
  })

  it("allows public hostnames", async () => {
    await expect(assertUrlSafe("https://example.com/")).resolves.toBeUndefined()
  })

  it("detects IPv4-mapped IPv6 private addresses", () => {
    expect(isPrivateOrLocalAddress("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateOrLocalAddress("::ffff:10.0.0.1")).toBe(true)
    expect(isPrivateOrLocalAddress("::ffff:7f00:1")).toBe(true)
    expect(isPrivateOrLocalAddress("::ffff:8.8.8.8")).toBe(false)
    expect(isPrivateOrLocalAddress("8.8.8.8")).toBe(false)
  })
})
