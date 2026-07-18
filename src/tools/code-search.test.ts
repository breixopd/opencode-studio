import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { searchGitHubCode } from "./code-search"

describe("searchGitHubCode", () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.GITHUB_TOKEN
  let lastHeaders: RequestInit["headers"] | undefined

  beforeEach(() => {
    lastHeaders = undefined
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      lastHeaders = init?.headers
      return new Response(
        JSON.stringify({
          items: [
            {
              name: "foo.ts",
              path: "src/foo.ts",
              html_url: "https://github.com/acme/app/blob/main/src/foo.ts",
              repository: { full_name: "acme/app" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalToken
  })

  it("sends Authorization Bearer when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "ghs_test_token_123"
    const hits = await searchGitHubCode("foo", 1)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.repo).toBe("acme/app")

    const headers = new Headers(lastHeaders)
    expect(headers.get("Authorization")).toBe("Bearer ghs_test_token_123")
    expect(headers.get("Accept")).toBe("application/vnd.github+json")
  })

  it("omits Authorization when GITHUB_TOKEN is unset", async () => {
    delete process.env.GITHUB_TOKEN
    await searchGitHubCode("foo", 1)
    const headers = new Headers(lastHeaders)
    expect(headers.get("Authorization")).toBeNull()
  })
})
