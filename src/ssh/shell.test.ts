import { describe, it, expect, mock } from "bun:test"
import type { Client } from "ssh2"
import type { SSHSession } from "./types"

const mockExecCommand = mock(() => Promise.resolve("/bin/bash"))

mock.module("../ssh/manager", () => ({
  execCommand: mockExecCommand,
  createSession: mock(() => Promise.resolve({} as SSHSession)),
  closeSession: mock(() => Promise.resolve()),
}))

const { detectRemoteShell } = await import("./shell")

function makeSession(): SSHSession {
  return {
    client: {} as Client,
    config: { user: "test", host: "testhost", identityFile: "/key" },
    alive: true,
    controlPath: "ssh2://test@testhost",
  }
}

describe("detectRemoteShell", () => {
  it("returns the detected shell from execCommand output", async () => {
    mockExecCommand.mockResolvedValueOnce("/bin/zsh")
    const session = makeSession()

    const result = await detectRemoteShell(session)

    expect(result).toBe("/bin/zsh")
    expect(mockExecCommand).toHaveBeenCalledWith(session, "echo $SHELL")
  })

  it("trims whitespace from shell path", async () => {
    mockExecCommand.mockResolvedValueOnce("  /bin/bash  ")
    const session = makeSession()

    const result = await detectRemoteShell(session)

    expect(result).toBe("/bin/bash")
  })

  it("returns /bin/sh when execCommand returns empty string", async () => {
    mockExecCommand.mockResolvedValueOnce("")
    const session = makeSession()

    const result = await detectRemoteShell(session)

    expect(result).toBe("/bin/sh")
  })

  it("returns /bin/sh when execCommand returns whitespace-only", async () => {
    mockExecCommand.mockResolvedValueOnce("   ")
    const session = makeSession()

    const result = await detectRemoteShell(session)

    expect(result).toBe("/bin/sh")
  })

  it("returns /bin/sh when execCommand throws an error", async () => {
    mockExecCommand.mockRejectedValueOnce(new Error("Connection lost"))
    const session = makeSession()

    const result = await detectRemoteShell(session)

    expect(result).toBe("/bin/sh")
  })

  it("passes the session object to execCommand", async () => {
    const session = makeSession()

    await detectRemoteShell(session)

    expect(mockExecCommand).toHaveBeenCalledWith(session, "echo $SHELL")
  })
})
