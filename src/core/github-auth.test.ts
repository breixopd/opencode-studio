import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { clearGitHubTokenCache, resolveGitHubAuth, resolveGitHubToken } from "./github-auth"
import * as child_process from "child_process"
import { EventEmitter } from "events"

describe("github-auth", () => {
  const originalGithub = process.env.GITHUB_TOKEN
  const originalGh = process.env.GH_TOKEN
  let spawnSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    clearGitHubTokenCache()
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN
  })

  afterEach(() => {
    clearGitHubTokenCache()
    spawnSpy?.mockRestore()
    if (originalGithub === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalGithub
    if (originalGh === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = originalGh
  })

  it("prefers GITHUB_TOKEN over GH_TOKEN and gh", async () => {
    process.env.GITHUB_TOKEN = "env_github"
    process.env.GH_TOKEN = "env_gh"
    const auth = await resolveGitHubAuth()
    expect(auth).toEqual({ token: "env_github", source: "GITHUB_TOKEN" })
  })

  it("uses GH_TOKEN when GITHUB_TOKEN unset", async () => {
    process.env.GH_TOKEN = "env_gh_only"
    const auth = await resolveGitHubAuth()
    expect(auth).toEqual({ token: "env_gh_only", source: "GH_TOKEN" })
  })

  it("falls back to gh auth token", async () => {
    spawnSpy = spyOn(child_process, "spawn").mockImplementation((() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      queueMicrotask(() => {
        proc.stdout.emit("data", Buffer.from("gho_from_cli\n"))
        proc.emit("close", 0)
      })
      return proc as unknown as ReturnType<typeof child_process.spawn>
    }) as typeof child_process.spawn)

    const auth = await resolveGitHubAuth()
    expect(auth.source).toBe("gh")
    expect(auth.token).toBe("gho_from_cli")
    expect(await resolveGitHubToken()).toBe("gho_from_cli")
  })

  it("returns none when env and gh unavailable", async () => {
    spawnSpy = spyOn(child_process, "spawn").mockImplementation((() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      queueMicrotask(() => {
        proc.stderr.emit("data", Buffer.from("not logged in"))
        proc.emit("close", 1)
      })
      return proc as unknown as ReturnType<typeof child_process.spawn>
    }) as typeof child_process.spawn)

    const auth = await resolveGitHubAuth()
    expect(auth).toEqual({ source: "none" })
    expect(await resolveGitHubToken()).toBeUndefined()
  })
})
