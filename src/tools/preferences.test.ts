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

  it("refuses set_autonomy full without accept_risk", async () => {
    const { clearAutonomyFullRisk, setAutonomyMode, consumeToast } = await importRiskHelpers()
    clearAutonomyFullRisk()
    setAutonomyMode("suggest")
    consumeToast()

    const result = await studio_preferences.execute(
      { action: "set_autonomy", autonomy: "full" },
      ctx,
    )
    expect(result).toContain("risk acceptance")
    expect(result).not.toContain("Autonomy set to 'full'")
  })

  it("set_autonomy full with accept_risk succeeds", async () => {
    const { clearAutonomyFullRisk, setAutonomyMode, hasAccepted, consumeToast } =
      await importRiskHelpers()
    clearAutonomyFullRisk()
    setAutonomyMode("suggest")
    consumeToast()

    const result = await studio_preferences.execute(
      { action: "set_autonomy", autonomy: "full", accept_risk: true },
      ctx,
    )
    expect(result).toContain("Autonomy set to 'full'")
    expect(hasAccepted()).toBe(true)
    consumeToast()
    clearAutonomyFullRisk()
    setAutonomyMode("suggest")
  })

  it("accept_autonomy_risk and clear_autonomy_risk", async () => {
    const { clearAutonomyFullRisk, hasAccepted, consumeToast } = await importRiskHelpers()
    clearAutonomyFullRisk()
    consumeToast()

    const accepted = await studio_preferences.execute({ action: "accept_autonomy_risk" }, ctx)
    expect(accepted).toContain("risk accepted")
    expect(hasAccepted()).toBe(true)
    consumeToast()

    const show = await studio_preferences.execute({ action: "show" }, ctx)
    expect(show).toContain("Autonomy full risk accepted: yes")

    const cleared = await studio_preferences.execute({ action: "clear_autonomy_risk" }, ctx)
    expect(cleared).toContain("cleared")
    expect(hasAccepted()).toBe(false)
  })
})

async function importRiskHelpers() {
  const profile = await import("../core/project-profile")
  const toast = await import("../core/toast-bus")
  return {
    clearAutonomyFullRisk: profile.clearAutonomyFullRisk,
    setAutonomyMode: profile.setAutonomyMode,
    hasAccepted: profile.hasAcceptedAutonomyFullRisk,
    consumeToast: toast.consumeStudioToast,
  }
}
