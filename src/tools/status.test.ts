import { describe, it, expect, mock, beforeEach } from "bun:test"

const mockLoadConfig = mock(() => ({
  ssh: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", port: 22 },
  tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
  projects: {},
  defaultExcludes: [".git/"],
}))

const mockListProjects = mock((config: any) => ({ ...config.projects }))

let tunnelAlive = false
let tunnelState: any = null

const mockIsTunnelAlive = mock(() => tunnelAlive)
const mockGetTunnelState = mock(() => tunnelState)

mock.module("../config/config", () => ({
  loadConfig: mockLoadConfig,
  listProjects: mockListProjects,
  addProject: mock(() => {}),
  removeProject: mock(() => {}),
}))

mock.module("../core/auto", () => ({
  ensureStudioReady: mockLoadConfig,
}))

mock.module("../tunnel/manager", () => ({
  isTunnelAlive: mockIsTunnelAlive,
  getTunnelState: mockGetTunnelState,
}))

const { studio_status, studio_list_projects } = await import("./status")

const ctx: any = null!

describe("studio_status", () => {
  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockListProjects.mockClear()
    mockIsTunnelAlive.mockClear()
    mockGetTunnelState.mockClear()
    tunnelAlive = false
    tunnelState = null
  })

  it("returns stopped tunnel status when tunnel is not alive", async () => {
    const result = await studio_status.execute({} as any, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.tunnel.status).toBe("stopped")
    expect(parsed.ssh.host).toBe("remote.example.com")
    expect(parsed.ssh.user).toBe("dev")
    expect(parsed.projectCount).toBe(0)
    expect(parsed.projects).toEqual([])
  })

  it("returns running tunnel status with connection details", async () => {
    tunnelAlive = true
    tunnelState = {
      config: { localPort: 8443, host: "remote.example.com" },
      alive: true,
      startTime: Date.now() - 120000,
      lastHeartbeat: Date.now(),
      lastError: null,
    }

    const result = await studio_status.execute({} as any, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.tunnel.status).toBe("running")
    expect(parsed.tunnel.port).toBe(8443)
    expect(parsed.tunnel.host).toBe("remote.example.com")
  })

  it("includes project list when projects are configured", async () => {
    mockLoadConfig.mockReturnValueOnce({
      ssh: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", port: 22 },
      tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
      projects: {
        myapp: { local: "/home/dev/myapp", remote: "/opt/app/myapp", excludes: [".git/"] },
        docs: { local: "/home/dev/docs", remote: "/opt/docs", excludes: [] },
      },
      defaultExcludes: [".git/"],
    })
    mockListProjects.mockReturnValueOnce({
      myapp: { local: "/home/dev/myapp", remote: "/opt/app/myapp", excludes: [".git/"] },
      docs: { local: "/home/dev/docs", remote: "/opt/docs", excludes: [] },
    })

    const result = await studio_status.execute({} as any, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.projectCount).toBe(2)
    expect(parsed.projects).toHaveLength(2)
    expect(parsed.projects[0].name).toBe("myapp")
    expect(parsed.projects[1].name).toBe("docs")
  })

  it("returns zero projects when no projects configured", async () => {
    const result = await studio_status.execute({} as any, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.projectCount).toBe(0)
    expect(parsed.projects).toEqual([])
  })

  it("calls ensureStudioReady and tunnel checks", async () => {
    await studio_status.execute({} as any, ctx)

    expect(mockLoadConfig).toHaveBeenCalled()
  })

  it("calls isTunnelAlive and getTunnelState", async () => {
    tunnelAlive = true
    tunnelState = {
      config: { localPort: 8443, host: "remote.example.com" },
      alive: true,
    }

    await studio_status.execute({} as any, ctx)

    expect(mockIsTunnelAlive).toHaveBeenCalledTimes(1)
    expect(mockGetTunnelState).toHaveBeenCalledTimes(1)
  })
})

describe("studio_list_projects", () => {
  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockListProjects.mockClear()
  })

  it("returns formatted list when projects exist", async () => {
    mockLoadConfig.mockReturnValueOnce({
      ssh: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", port: 22 },
      tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
      projects: {
        myapp: { local: "/home/dev/myapp", remote: "/opt/app/myapp", excludes: [".git/"] },
        docs: { local: "/home/dev/docs", remote: "/opt/docs", excludes: [] },
      },
      defaultExcludes: [".git/"],
    })
    mockListProjects.mockReturnValueOnce({
      myapp: { local: "/home/dev/myapp", remote: "/opt/app/myapp", excludes: [".git/"] },
      docs: { local: "/home/dev/docs", remote: "/opt/docs", excludes: [] },
    })

    const result = await studio_list_projects.execute({} as any, ctx)

    expect(result).toContain("Projects (2):")
    expect(result).toContain("myapp")
    expect(result).toContain("/home/dev/myapp")
    expect(result).toContain("remote.example.com:/opt/app/myapp")
    expect(result).toContain("docs")
  })

  it("returns message when no projects configured", async () => {
    const result = await studio_list_projects.execute({} as any, ctx)

    expect(result).toContain("No projects yet")
  })

  it("returns single project correctly", async () => {
    mockLoadConfig.mockReturnValueOnce({
      ssh: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", port: 22 },
      tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
      projects: {
        solo: { local: "/home/dev/solo", remote: "/opt/solo", excludes: [] },
      },
      defaultExcludes: [".git/"],
    })
    mockListProjects.mockReturnValueOnce({
      solo: { local: "/home/dev/solo", remote: "/opt/solo", excludes: [] },
    })

    const result = await studio_list_projects.execute({} as any, ctx)

    expect(result).toContain("Projects (1):")
    expect(result).toContain("solo")
    expect(result).toContain("remote.example.com:/opt/solo")
  })
})
