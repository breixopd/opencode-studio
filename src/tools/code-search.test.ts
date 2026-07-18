import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { searchGitHubCode } from "./code-search"
import { clearGitHubTokenCache } from "../core/github-auth"
import * as child_process from "child_process"
import { EventEmitter } from "events"

describe("searchGitHubCode", () => {
  const originalFetch = globalThis.fetch
  const originalGithub = process.env.GITHUB_TOKEN
  const originalGh = process.env.GH_TOKEN
  let lastHeaders: RequestInit["headers"] | undefined
  let spawnSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    clearGitHubTokenCache()
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN
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
    clearGitHubTokenCache()
    spawnSpy?.mockRestore()
    if (originalGithub === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalGithub
    if (originalGh === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = originalGh
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

  it("uses gh auth token when env unset", async () => {
    spawnSpy = spyOn(child_process, "spawn").mockImplementation((() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      queueMicrotask(() => {
        proc.stdout.emit("data", Buffer.from("gho_cli_token\n"))
        proc.emit("close", 0)
      })
      return proc as unknown as ReturnType<typeof child_process.spawn>
    }) as typeof child_process.spawn)

    await searchGitHubCode("foo", 1)
    const headers = new Headers(lastHeaders)
    expect(headers.get("Authorization")).toBe("Bearer gho_cli_token")
  })

  it("omits Authorization when env and gh unavailable", async () => {
    spawnSpy = spyOn(child_process, "spawn").mockImplementation((() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      queueMicrotask(() => {
        proc.emit("close", 1)
      })
      return proc as unknown as ReturnType<typeof child_process.spawn>
    }) as typeof child_process.spawn)

    await searchGitHubCode("foo", 1)
    const headers = new Headers(lastHeaders)
    expect(headers.get("Authorization")).toBeNull()
  })
})
