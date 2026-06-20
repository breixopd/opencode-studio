import { describe, it, expect, mock, beforeEach } from "bun:test"

const mockLoadConfig = mock(() => ({
  ssh: { user: "", host: "", identityFile: "" },
  tunnel: { localPort: 8443, remotePort: 8443, host: "" },
  projects: {},
  defaultExcludes: [".git/"],
}))

let savedConfig: Record<string, unknown> | null = null
const mockSaveConfig = mock((config: unknown) => {
  savedConfig = config as Record<string, unknown>
})

type SSHHost = { alias: string; host: string; user?: string; identityFile?: string; port?: number }
let mockHosts: SSHHost[] = []

const mockParseSSHConfig = mock(() => mockHosts)

mock.module("../config/config", () => ({
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
}))

mock.module("../config/ssh-config", () => ({
  parseSSHConfig: mockParseSSHConfig,
}))

const { studio_setup } = await import("./setup")

const ctx: any = null!

describe("studio_setup", () => {
  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockSaveConfig.mockClear()
    mockParseSSHConfig.mockClear()
    mockHosts = []
    savedConfig = null
  })

  it("returns multiple hosts when SSH hosts are found and no host specified", async () => {
    mockHosts = [
      { alias: "myserver", host: "myserver.example.com", user: "admin", identityFile: "/home/user/.ssh/id_rsa" },
      { alias: "devbox", host: "192.168.1.100", user: "dev" },
    ]

    const result = await studio_setup.execute({}, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.status).toBe("multiple_hosts")
    expect(parsed.all_hosts).toHaveLength(2)
    expect(mockSaveConfig).not.toHaveBeenCalled()
  })

  it("returns already_configured when config exists without force", async () => {
    mockLoadConfig.mockReturnValueOnce({
      ssh: { user: "dev", host: "existing-host", identityFile: "/tmp/key" },
      tunnel: { localPort: 8443, remotePort: 8443, host: "existing-host" },
      projects: {},
      defaultExcludes: [".git/"],
    })

    mockHosts = [
      { alias: "myserver", host: "myserver.example.com", user: "admin", identityFile: "/home/user/.ssh/id_rsa" },
      { alias: "devbox", host: "192.168.1.100", user: "dev" },
    ]

    const result = await studio_setup.execute({}, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.status).toBe("already_configured")
    expect(mockSaveConfig).not.toHaveBeenCalled()
  })

  it("re-detects with force:true", async () => {
    mockLoadConfig.mockReturnValueOnce({
      ssh: { user: "dev", host: "existing-host", identityFile: "/tmp/key" },
      tunnel: { localPort: 8443, remotePort: 8443, host: "existing-host" },
      projects: {},
      defaultExcludes: [".git/"],
    })

    mockHosts = [{ alias: "newhost", host: "newhost.example.com", user: "admin" }]

    const result = await studio_setup.execute({ force: true }, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.status).toBe("detected")
    expect(parsed.detected_host.alias).toBe("newhost")
    expect(mockSaveConfig).toHaveBeenCalledTimes(1)
  })

  it("returns no_hosts when SSH config is empty", async () => {
    mockHosts = []

    const result = await studio_setup.execute({}, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.status).toBe("no_hosts")
    expect(parsed.message).toContain("No SSH hosts found")
    expect(mockSaveConfig).not.toHaveBeenCalled()
  })

  it("uses alias as host when no hostname is set", async () => {
    mockHosts = [{ alias: "bare-alias", host: "bare-alias", user: "testuser" }]

    const result = await studio_setup.execute({}, ctx)
    const parsed = JSON.parse(result as string)

    expect(parsed.status).toBe("detected")
    expect(parsed.config.host).toBe("bare-alias")
    expect(parsed.config.user).toBe("testuser")
  })

  it("saves config with correct structure", async () => {
    mockHosts = [{ alias: "saved-host", host: "saved.example.com", user: "me", identityFile: "/home/me/.ssh/key" }]

    await studio_setup.execute({}, ctx)

    expect(savedConfig).not.toBeNull()
    expect((savedConfig as any).ssh.host).toBe("saved.example.com")
    expect((savedConfig as any).ssh.user).toBe("me")
    expect((savedConfig as any).ssh.identityFile).toBe("/home/me/.ssh/key")
    expect((savedConfig as any).tunnel.host).toBe("saved.example.com")
  })
})
