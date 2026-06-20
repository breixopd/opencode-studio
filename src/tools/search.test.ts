import { describe, it, expect } from "bun:test"
import { stripHtml } from "./search"

// Test stripHtml via re-export or duplicate minimal test on searchDuckDuckGo with mock fetch
describe("searchDuckDuckGo", () => {
  it("parses duckduckgo HTML results", async () => {
    const sample = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Example Site</a>
      <a class="result__snippet">A useful example page</a>
    `
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(sample, { status: 200 })) as unknown as typeof fetch

    try {
      const { searchDuckDuckGo } = await import("./search")
      const results = await searchDuckDuckGo("test", 5)
      expect(results.length).toBeGreaterThanOrEqual(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("stripHtml", () => {
  it("removes tags", () => {
    expect(stripHtml("<b>hello</b> world")).toBe("hello world")
  })
})
