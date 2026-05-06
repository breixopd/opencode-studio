import { mock, describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EventEmitter } from "events"
import { setSSHFactory, resetSSHFactory } from "../ssh/factory"
import type { SSHClientFactory } from "../ssh/factory"
import type { SSHSession, SSHSessionConfig } from "../ssh/types"
import type { Client } from "ssh2"

// ---------------------------------------------------------------------------
// Port availability tracking (for isPortAvailable / findAvailablePort)
// ---------------------------------------------------------------------------
let portStatus: Map<number, boolean> = new Map()
let netCreateServerHandler: ((socket: any) => void) | null = null

const mockCreateServer = mock((handler?: (socket: any) => void) => {
  netCreateServerHandler = handler || null

  const server: any = new EventEmitter()
  server._listening = false

  server.listen = mock((port: number, ...rest: any[]) => {
    if (portStatus.get(port) === false) {
      setImmediate(() => server.emit("error", new Error("EADDRINUSE")))
      return
    }
    server._listening = true
    const cb = rest.find((a) => typeof a === "function")
    if (cb) setImmediate(cb)
  })

  server.close = mock((cb?: () => void) => {
    server._listening = false
    if (cb) setImmediate(cb)
  })

  Object.defineProperty(server, "listening", {
    get: () => server._listening,
    configurable: true,
  })

  return server
})

mock.module("net", () => ({
  createServer: mockCreateServer,
}))

// ---------------------------------------------------------------------------
// ssh2 mock
// ---------------------------------------------------------------------------

function createMockClient() {
  const client: any = new EventEmitter()
  client.connect = mock(() => {})
  client.end = mock(() => {})

  const forwardOutStream: any = new EventEmitter()
  forwardOutStream.pipe = mock(() => forwardOutStream)
  forwardOutStream.end = mock(() => {})

  client.forwardOut = mock(
    (
      _srcIP: string,
      _srcPort: number,
      _dstIP: string,
      _dstPort: number,
      cb: (err: Error | null, stream?: any) => void,
    ) => {
      setImmediate(() => cb(null, forwardOutStream))
    },
  )

  return { client, forwardOutStream }
}

let mockClient: ReturnType<typeof createMockClient>

const mockFactory: SSHClientFactory = {
  connect: mock(
    async (config: SSHSessionConfig): Promise<SSHSession> => {
      return {
        config,
        client: mockClient.client as unknown as Client,
        alive: true,
        controlPath: `ssh2://${config.user}@${config.host}`,
      }
    },
  ),
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  startTunnel,
  stopTunnel,
  isTunnelAlive,
  isPortAvailable,
  findAvailablePort,
  getTunnelState,
  _resetTunnelState,
} from "./manager"
import type { TunnelConfig } from "./manager"

const defaultConfig: TunnelConfig = {
  user: "dev",
  host: "devbox.example.com",
  identityFile: "/home/dev/.ssh/id_ed25519",
  localPort: 8444,
  remotePort: 8443,
}

describe("Tunnel Manager (ssh2)", () => {
  beforeEach(() => {
    _resetTunnelState()
    portStatus = new Map()
    netCreateServerHandler = null
    mockCreateServer.mockClear()

    mockClient = createMockClient()
    mockClient.client.forwardOut.mockClear()

    // Reset mock factory connect
    ;(mockFactory.connect as ReturnType<typeof mock>).mockClear()

    setSSHFactory(mockFactory)
  })

  afterEach(() => {
    _resetTunnelState()
    resetSSHFactory()
  })

  // -----------------------------------------------------------------------
  // startTunnel
  // -----------------------------------------------------------------------

  describe("startTunnel", () => {
    test("connects via sshFactory with correct config", async () => {
      const state = await startTunnel(defaultConfig)

      expect(state.alive).toBe(true)
      expect(state.config.localPort).toBeGreaterThan(0)
      expect(state.config.user).toBe("dev")
      expect(state.config.host).toBe("devbox.example.com")

      expect(mockFactory.connect).toHaveBeenCalledTimes(1)

      const connectArg = (mockFactory.connect as ReturnType<typeof mock>).mock
        .calls[0][0] as SSHSessionConfig
      expect(connectArg.user).toBe("dev")
      expect(connectArg.host).toBe("devbox.example.com")
      expect(connectArg.identityFile).toBe("/home/dev/.ssh/id_ed25519")

      // Last createServer call is the tunnel's forwarding server
      // (earlier calls are from isPortAvailable / findAvailablePort)
      const results = mockCreateServer.mock.results
      const server = results[results.length - 1]?.value
      expect(server.listen).toHaveBeenCalledWith(expect.any(Number), "127.0.0.1")
    })

    test("falls back to next port when preferred port is occupied", async () => {
      portStatus.set(8444, false)

      const state = await startTunnel(defaultConfig)

      expect(state.config.localPort).toBe(8445)
    })

    test("falls back to port 8446 when 8444 and 8445 are occupied", async () => {
      portStatus.set(8444, false)
      portStatus.set(8445, false)

      const state = await startTunnel(defaultConfig)

      expect(state.config.localPort).toBe(8446)
    })

    test("throws if tunnel is already running", async () => {
      await startTunnel(defaultConfig)

      await expect(startTunnel(defaultConfig)).rejects.toThrow(
        "Tunnel is already running on port ",
      )
    })

    test("sets tunnel state correctly", async () => {
      const state = await startTunnel(defaultConfig)

      expect(state.alive).toBe(true)
      expect(state.startTime).toBeGreaterThan(0)
      expect(state.lastHeartbeat).toBeGreaterThan(0)
      expect(state.lastError).toBeNull()
    })

    test("creates server connection handler that forwardOuts to remote port", async () => {
      await startTunnel(defaultConfig)

      // Simulate an incoming connection
      const fakeSocket: any = new EventEmitter()
      fakeSocket.pipe = mock(() => fakeSocket)
      fakeSocket.end = mock(() => {})
      fakeSocket.destroy = mock(() => {})

      netCreateServerHandler!(fakeSocket)

      expect(mockClient.client.forwardOut).toHaveBeenCalledWith(
        "127.0.0.1",
        expect.any(Number),
        "127.0.0.1",
        8443,
        expect.any(Function),
      )
    })

    test("marks tunnel as dead and records error on SSH close", async () => {
      await startTunnel(defaultConfig)

      expect(isTunnelAlive()).toBe(true)

      mockClient.client.emit("close")

      expect(isTunnelAlive()).toBe(false)

      const state = getTunnelState()
      expect(state?.alive).toBe(false)
      expect(state?.lastError).toContain("SSH connection closed")
    })

    test("records error on SSH error event", async () => {
      await startTunnel(defaultConfig)

      mockClient.client.emit("error", new Error("Connection refused"))

      const state = getTunnelState()
      expect(state?.lastError).toBe("Connection refused")
    })
  })

  // -----------------------------------------------------------------------
  // stopTunnel
  // -----------------------------------------------------------------------

  describe("stopTunnel", () => {
    test("calls client.end() on running tunnel", async () => {
      await startTunnel(defaultConfig)

      const result = stopTunnel()

      expect(result).toBe(true)
      expect(mockClient.client.end).toHaveBeenCalled()
    })

    test("returns false when no tunnel is running", () => {
      expect(stopTunnel()).toBe(false)
    })

    test("clears isTunnelAlive after stop", async () => {
      await startTunnel(defaultConfig)
      expect(isTunnelAlive()).toBe(true)

      stopTunnel()
      expect(isTunnelAlive()).toBe(false)
    })

    test("does not throw if session is already dead", async () => {
      await startTunnel(defaultConfig)
      mockClient.client.end = mock(() => {
        throw new Error("not connected")
      })

      await expect(
        new Promise<void>((resolve) => {
          stopTunnel()
          resolve()
        }),
      ).resolves.toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // isTunnelAlive
  // -----------------------------------------------------------------------

  describe("isTunnelAlive", () => {
    test("returns false before tunnel is started", () => {
      expect(isTunnelAlive()).toBe(false)
    })

    test("returns true while tunnel is running", async () => {
      await startTunnel(defaultConfig)
      expect(isTunnelAlive()).toBe(true)
    })

    test("returns false after tunnel is stopped", async () => {
      await startTunnel(defaultConfig)
      stopTunnel()
      expect(isTunnelAlive()).toBe(false)
    })

    test("returns false after SSH session closes", async () => {
      await startTunnel(defaultConfig)
      mockClient.client.emit("close")
      expect(isTunnelAlive()).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // findAvailablePort
  // -----------------------------------------------------------------------

  describe("findAvailablePort", () => {
    test("returns preferred port when available", async () => {
      const port = await findAvailablePort(8444)
      expect(port).toBe(8444)
    })

    test("returns next port when preferred is occupied", async () => {
      portStatus.set(8444, false)
      const port = await findAvailablePort(8444)
      expect(port).toBe(8445)
    })

    test("throws when all ports up to maxAttempts are occupied", async () => {
      for (let i = 0; i < 5; i++) {
        portStatus.set(8444 + i, false)
      }

      await expect(findAvailablePort(8444, 5)).rejects.toThrow(
        "No available port found starting from 8444",
      )
    })

    test("respects custom maxAttempts", async () => {
      portStatus.set(8444, false)
      portStatus.set(8445, false)

      const port = await findAvailablePort(8444, 10)
      expect(port).toBe(8446)
    })
  })

  // -----------------------------------------------------------------------
  // isPortAvailable
  // -----------------------------------------------------------------------

  describe("isPortAvailable", () => {
    test("returns true when port is free", async () => {
      const available = await isPortAvailable(8444)
      expect(available).toBe(true)
    })

    test("returns false when port is occupied", async () => {
      portStatus.set(8444, false)
      const available = await isPortAvailable(8444)
      expect(available).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // getTunnelState
  // -----------------------------------------------------------------------

  describe("getTunnelState", () => {
    test("returns null when no tunnel is running", () => {
      expect(getTunnelState()).toBeNull()
    })

    test("returns state copy when tunnel is running", async () => {
      await startTunnel(defaultConfig)
      const state = getTunnelState()
      expect(state).not.toBeNull()
      expect(state!.config.user).toBe("dev")
      expect(state!.alive).toBe(true)
    })
  })
})
