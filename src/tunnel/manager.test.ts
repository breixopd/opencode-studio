import { mock, describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EventEmitter } from "events"

function createFakeProcess() {
  const proc: any = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = new EventEmitter()
  proc.stdin.write = mock(() => true)
  proc.stdin.end = mock(() => {})
  proc.kill = mock(() => {})
  proc.pid = 99999
  return proc
}

let sharedProcess: ReturnType<typeof createFakeProcess>
const mockSpawn = mock<(cmd: string, args: readonly string[], opts?: object) => any>(
  () => sharedProcess,
)

mock.module("child_process", () => ({
  spawn: mockSpawn,
  ChildProcess: class {},
}))

let portStatus: Map<number, boolean> = new Map()

const mockCreateServer = mock(() => {
  const server: any = new EventEmitter()
  server.listen = mock((port: number, ...rest: any[]) => {
    const cb = rest[rest.length - 1]
    if (typeof cb === "function") {
      if (portStatus.get(port) === false) {
        setImmediate(() => server.emit("error", new Error("EADDRINUSE")))
      } else {
        cb()
      }
    }
  })
  server.close = mock((cb?: () => void) => {
    if (cb) setImmediate(cb)
  })
  return server
})

mock.module("net", () => ({
  createServer: mockCreateServer,
}))

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

describe("Tunnel Manager", () => {
  beforeEach(() => {
    _resetTunnelState()
    sharedProcess = createFakeProcess()
    mockSpawn.mockClear()
    mockCreateServer.mockClear()
    portStatus = new Map()
  })

  afterEach(() => {
    _resetTunnelState()
  })

  describe.skipIf(!!process.env.CI)("startTunnel", () => {
    test("spawns SSH with correct args", async () => {
      const state = await startTunnel(defaultConfig)

      expect(state.alive).toBe(true)
      expect(state.config.localPort).toBe(8444)
      expect(state.config.user).toBe("dev")
      expect(state.config.host).toBe("devbox.example.com")

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const call = mockSpawn.mock.calls[0] as [string, string[], { stdio: string[] }]

      expect(call[0]).toBe("ssh")

      const args = call[1]
      expect(args).toContain("-o")
      expect(args).toContain("StrictHostKeyChecking=accept-new")
      expect(args).toContain("ExitOnForwardFailure=yes")
      expect(args).toContain("ServerAliveInterval=30")
      expect(args).toContain("ServerAliveCountMax=3")
      expect(args).toContain("TCPKeepAlive=yes")
      expect(args).toContain("-i")
      expect(args).toContain("/home/dev/.ssh/id_ed25519")
      expect(args).toContain("-L")
      expect(args).toContain("8444:localhost:8443")
      expect(args).toContain("-N")
      expect(args).toContain("dev@devbox.example.com")

      const controlPathArg = args.find((a: string) =>
        a.startsWith("ControlPath="),
      )
      expect(controlPathArg).toBeDefined()
      expect(controlPathArg).toContain("studio-tunnel-dev@devbox.example.com")

      expect(call[2]?.stdio).toEqual(["pipe", "pipe", "pipe"])
    })

    test("falls back to next port when preferred port is occupied", async () => {
      portStatus.set(8444, false)

      const state = await startTunnel(defaultConfig)

      expect(state.config.localPort).toBe(8445)

      const call = mockSpawn.mock.calls[0] as [string, string[]]
      expect(call[1]).toContain("8445:localhost:8443")
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
        "Tunnel is already running on port 8444",
      )
    })

    test("sets tunnel state correctly", async () => {
      const state = await startTunnel(defaultConfig)

      expect(state.alive).toBe(true)
      expect(state.process).toBe(sharedProcess)
      expect(state.startTime).toBeGreaterThan(0)
      expect(state.lastHeartbeat).toBeGreaterThan(0)
      expect(state.lastError).toBeNull()
    })

    test("captures stderr output", async () => {
      await startTunnel(defaultConfig)

      sharedProcess.stderr.emit(
        "data",
        Buffer.from("ssh: connect to host devbox.example.com port 22: Connection refused"),
      )

      const state = getTunnelState()
      expect(state?.lastError).toContain("Connection refused")
    })

    test("marks tunnel as dead and sets error on close", async () => {
      await startTunnel(defaultConfig)

      sharedProcess.emit("close", 255)

      const state = getTunnelState()
      expect(state?.alive).toBe(false)
      expect(state?.lastError).toContain("exited with code 255")
    })
  })

  describe("stopTunnel", () => {
    test.skipIf(!!process.env.CI)("sends SIGTERM to running tunnel", async () => {
      await startTunnel(defaultConfig)

      const result = stopTunnel()

      expect(result).toBe(true)
      expect(sharedProcess.kill).toHaveBeenCalledWith("SIGTERM")
    })

    test.skipIf(!!process.env.CI)("returns false when no tunnel is running", () => {
      expect(stopTunnel()).toBe(false)
    })

    test("clears isTunnelAlive after stop", async () => {
      await startTunnel(defaultConfig)
      expect(isTunnelAlive()).toBe(true)

      stopTunnel()
      expect(isTunnelAlive()).toBe(false)
    })

    test("does not throw if process is already dead", async () => {
      sharedProcess.kill = mock(() => {
        throw new Error("ESRCH")
      })
      await startTunnel(defaultConfig)

      await expect(
        new Promise<void>((resolve) => {
          stopTunnel()
          resolve()
        }),
      ).resolves.toBeUndefined()
    })
  })

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

    test.skipIf(!!process.env.CI)("returns false after process exits", async () => {
      await startTunnel(defaultConfig)
      sharedProcess.emit("close", 0)
      expect(isTunnelAlive()).toBe(false)
    })
  })

  describe.skipIf(!!process.env.CI)("findAvailablePort", () => {
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

  describe("isPortAvailable", () => {
    test("returns true when port is free", async () => {
      const available = await isPortAvailable(8444)
      expect(available).toBe(true)
    })

    test.skipIf(!!process.env.CI)("returns false when port is occupied", async () => {
      portStatus.set(8444, false)
      const available = await isPortAvailable(8444)
      expect(available).toBe(false)
    })
  })

  describe("getTunnelState", () => {
    test.skipIf(!!process.env.CI)("returns null when no tunnel is running", () => {
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
