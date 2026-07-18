import { describe, it, expect, mock, beforeEach } from "bun:test"

const mockLoadConfig = mock(() => ({
  ssh: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", port: 22 },
  tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
  projects: {
    myapp: {
      local: "/home/user/myapp",
      remote: "/home/dev/myapp",
      excludes: [".git/"],
      commitStudio: false,
    },
  },
  defaultExcludes: [".git/"],
}))

const mockUpdateProject = mock(() => {})
const mockSaveConfig = mock(() => {})
const mockFindProject = mock(() => "myapp" as string | null)

mock.module("../config/config", () => ({
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  updateProject: mockUpdateProject,
  findProjectNameForLocal: mockFindProject,
}))

const { studio_preferences } = await import("./preferences")

const ctx: any = null!

describe("studio_preferences", () => {
  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockUpdateProject.mockClear()
    mockSaveConfig.mockClear()
    mockFindProject.mockClear()
    mockFindProject.mockReturnValue("myapp")
  })

  it("shows current preferences", async () => {
    const result = await studio_preferences.execute({ action: "show" }, ctx)
    expect(result).toContain("Project: myapp")
    expect(result).toContain("Remote: /home/dev/myapp")
    expect(result).toContain("gitignored")
    expect(result).toContain("Remote allowedHosts")
  })

  it("saves remote path", async () => {
    const result = await studio_preferences.execute(
      { action: "set_remote_path", remote: "/var/www/myapp" },
      ctx,
    )
    expect(result).toContain("/var/www/myapp")
    expect(mockUpdateProject).toHaveBeenCalledWith(
      expect.anything(),
      "myapp",
      { remote: "/var/www/myapp" },
    )
  })

  it("requires remote for set_remote_path", async () => {
    const result = await studio_preferences.execute({ action: "set_remote_path" }, ctx)
    expect(result).toContain("remote path required")
  })

  it("allows studio commit and updates gitignore", async () => {
    const result = await studio_preferences.execute(
      { action: "allow_studio_commit", allow: true },
      ctx,
    )
    expect(result).toContain("allowed")
    expect(mockUpdateProject).toHaveBeenCalledWith(
      expect.anything(),
      "myapp",
      { commitStudio: true },
    )
  })

  it("sets model mode", async () => {
    const result = await studio_preferences.execute(
      { action: "set_model_mode", model_mode: "free" },
      ctx,
    )
    expect(result).toContain("free")
  })

  it("saves remote policy allowlists", async () => {
    const result = await studio_preferences.execute(
      {
        action: "set_remote_policy",
        allowed_hosts: "dev, staging",
        allowed_command_prefixes: "npm ,bun ",
      },
      ctx,
    )
    expect(result).toContain("Remote policy saved")
    expect(result).toContain("dev")
    expect(result).toContain("staging")
    expect(mockSaveConfig).toHaveBeenCalledTimes(1)
  })
})
