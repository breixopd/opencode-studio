import { describe, it, expect, mock, afterEach } from "bun:test"
import { setSSHFactory, resetSSHFactory, sshFactory } from "./factory"
import type { SSHClientFactory } from "./factory"
import type { SSHSession } from "./types"
import type { Client } from "ssh2"

afterEach(() => {
  resetSSHFactory()
})

describe("SSH Factory", () => {
  it("starts with a RealSSHClientFactory by default", () => {
    expect(sshFactory).toBeDefined()
    expect(typeof sshFactory.connect).toBe("function")
  })

  it("setSSHFactory overrides the singleton factory", () => {
    const mockFactory: SSHClientFactory = {
      connect: mock(async () => ({}) as unknown as SSHSession),
    }

    setSSHFactory(mockFactory)

    expect(sshFactory).toBe(mockFactory)
  })

  it("resetSSHFactory restores the default RealSSHClientFactory", () => {
    const mockFactory: SSHClientFactory = {
      connect: mock(async () => ({}) as unknown as SSHSession),
    }

    setSSHFactory(mockFactory)
    expect(sshFactory).toBe(mockFactory)

    resetSSHFactory()

    expect(sshFactory).not.toBe(mockFactory)
    expect(typeof sshFactory.connect).toBe("function")
  })

  it("factory.connect is callable after reset", () => {
    resetSSHFactory()
    expect(typeof sshFactory.connect).toBe("function")
  })

  it("can set and reset multiple times", () => {
    const factoryA: SSHClientFactory = {
      connect: mock(async () => ({}) as unknown as SSHSession),
    }
    const factoryB: SSHClientFactory = {
      connect: mock(async () => ({}) as unknown as SSHSession),
    }

    setSSHFactory(factoryA)
    expect(sshFactory).toBe(factoryA)

    setSSHFactory(factoryB)
    expect(sshFactory).toBe(factoryB)

    resetSSHFactory()
    expect(sshFactory).not.toBe(factoryA)
    expect(sshFactory).not.toBe(factoryB)
  })

  it("factory is used by createSession after setSSHFactory", async () => {
    const mockClient = {
      exec: mock(() => {}),
      sftp: mock(() => {}),
      end: mock(() => {}),
      on: mock(() => {}),
      connect: mock(() => {}),
    }
    const mockSession: SSHSession = {
      client: mockClient as unknown as Client,
      config: { user: "test", host: "test", identityFile: "/key" },
      alive: true,
      controlPath: "ssh2://test@test",
    }
    const mockFactory: SSHClientFactory = {
      connect: mock(async () => mockSession),
    }

    setSSHFactory(mockFactory)

    const { createSession } = await import("./manager")
    const session = await createSession({
      user: "test",
      host: "test",
      identityFile: "/key",
    })

    expect(mockFactory.connect).toHaveBeenCalledWith({
      user: "test",
      host: "test",
      identityFile: "/key",
    })
    expect(session).toBe(mockSession)
  })
})
