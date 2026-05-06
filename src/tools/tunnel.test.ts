import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { TunnelState } from "../tunnel/manager"

const mockLoadConfig = mock(() => ({
  ssh: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", port: 22 },
  tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
  projects: {},
  defaultExcludes: [".git/"],
}))

let alive = false
let tunnelState: TunnelState | null = null

const mockIsTunnelAlive = mock(() => alive)
const mockGetTunnelState = mock(() => (tunnelState ? { ...tunnelState } : null))
const mockStopTunnel = mock(() => { alive = false; return true })
const mockStartTunnel = mock(() => {
  alive = true
    tunnelState = {
     config: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", localPort: 8443, remotePort: 8443 },
     alive: true,
     startTime: Date.now(),
     lastHeartbeat: Date.now(),
     lastError: null,
   }
   return Promise.resolve(tunnelState)
 })

mock.module("../config/config", () => ({
  loadConfig: mockLoadConfig,
  addProject: mock(() => {}),
  removeProject: mock(() => {}),
  listProjects: mock(() => ({})),
}))
mock.module("../tunnel/manager", () => ({
  isTunnelAlive: mockIsTunnelAlive,
  getTunnelState: mockGetTunnelState,
  stopTunnel: mockStopTunnel,
  startTunnel: mockStartTunnel,
  isPortAvailable: mock(() => Promise.resolve(true)),
  findAvailablePort: mock((p: number) => Promise.resolve(p)),
  _resetTunnelState: mock(() => {}),
}))

const { studio_tunnel_status, studio_tunnel_restart } = await import("./tunnel")

const ctx: any = null!

describe("studio_tunnel_status", () => {
  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockIsTunnelAlive.mockClear()
    mockGetTunnelState.mockClear()
  })

  it("returns stopped status when tunnel is not running", async () => {
    alive = false
    tunnelState = null

    const result = await studio_tunnel_status.execute({} as any, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.status).toBe("stopped")
    expect(parsed.message).toContain("not running")
  })

  it("returns running status with uptime when tunnel is alive", async () => {
    const startTime = Date.now() - 60000
    alive = true
    tunnelState = {
      config: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", localPort: 8443, remotePort: 8443 },
      alive: true,
      startTime,
      lastHeartbeat: Date.now(),
      lastError: null,
    }

    const result = await studio_tunnel_status.execute({} as any, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.status).toBe("running")
    expect(parsed.port).toBe(8443)
    expect(parsed.host).toBe("remote.example.com")
    expect(parsed.uptimeSeconds).toBeGreaterThanOrEqual(60)
  })

  it("includes lastError when tunnel has recorded errors", async () => {
    alive = true
    tunnelState = {
      config: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", localPort: 8443, remotePort: 8443 },
      alive: true,
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
      lastError: "Connection reset",
    }

    const result = await studio_tunnel_status.execute({} as any, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.lastError).toBe("Connection reset")
  })
})

describe("studio_tunnel_restart", () => {
  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockStopTunnel.mockClear()
    mockStartTunnel.mockClear()
    alive = false
    tunnelState = null
  })

  it("starts tunnel when none is running", async () => {
    const result = await studio_tunnel_restart.execute({} as any, ctx)

    expect(result).toContain("Tunnel restarted on port 8443")
    expect(mockStartTunnel).toHaveBeenCalledTimes(1)
  })

  it("stops existing tunnel before restarting", async () => {
    alive = true
    tunnelState = {
      config: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", localPort: 8443, remotePort: 8443 },
      alive: true,
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
      lastError: null,
    }

    const result = await studio_tunnel_restart.execute({} as any, ctx)

    expect(mockStopTunnel).toHaveBeenCalledTimes(1)
    expect(mockStartTunnel).toHaveBeenCalledTimes(1)
    expect(result).toContain("Tunnel restarted")
  })

  it("returns error when start fails", async () => {
    mockStartTunnel.mockRejectedValueOnce(new Error("SSH host unreachable"))

    const result = await studio_tunnel_restart.execute({} as any, ctx)

    expect(result).toContain("Error restarting tunnel")
    expect(result).toContain("SSH host unreachable")
  })
})
