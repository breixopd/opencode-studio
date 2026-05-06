import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test"
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs"
import { join } from "path"
import { z } from "zod"
import { safeValidateConfig, validateConfig } from "./schema"
import type { StudioConfig } from "./types"
import { DEFAULT_CONFIG, DEFAULT_EXCLUDES } from "./defaults"

const TMP_HOME = join(import.meta.dir, ".test-home")
const CONFIG_DIR = join(TMP_HOME, ".config", "opencode-studio")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")

let loadConfig: typeof import("./config").loadConfig
let saveConfig: typeof import("./config").saveConfig
let addProject: typeof import("./config").addProject
let removeProject: typeof import("./config").removeProject
let listProjects: typeof import("./config").listProjects

beforeAll(async () => {
  mock.module("os", () => ({ homedir: () => TMP_HOME }))
  const mod = await import("./config")
  loadConfig = mod.loadConfig
  saveConfig = mod.saveConfig
  addProject = mod.addProject
  removeProject = mod.removeProject
  listProjects = mod.listProjects
})

afterAll(() => {
  if (existsSync(TMP_HOME)) {
    rmSync(TMP_HOME, { recursive: true })
  }
  mock.restore()
})

function cleanConfig() {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true })
  mkdirSync(CONFIG_DIR, { recursive: true })
}

function writeTestConfig(data: unknown) {
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2))
}

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    cleanConfig()
    const config = loadConfig()
    expect(config.ssh.user).toBe(DEFAULT_CONFIG.ssh.user)
    expect(config.tunnel.localPort).toBe(DEFAULT_CONFIG.tunnel.localPort)
    expect(config.projects).toEqual({})
    expect(config.defaultExcludes).toEqual(DEFAULT_EXCLUDES)
  })

  it("creates config file on first load", () => {
    cleanConfig()
    loadConfig()
    expect(existsSync(CONFIG_PATH)).toBe(true)
  })

  it("reads existing config from disk", () => {
    cleanConfig()
    writeTestConfig({
      ssh: { user: "testuser", host: "testhost", identityFile: "/tmp/key" },
      tunnel: { localPort: 9999, remotePort: 9999, host: "testhost" },
      projects: { spectre: { local: "/tmp/spectre", remote: "/remote/spectre", excludes: [] } },
      defaultExcludes: [".git/"],
    })
    const config = loadConfig()
    expect(config.ssh.user).toBe("testuser")
    expect(config.projects["spectre"]).toBeDefined()
    expect(config.projects["spectre"].local).toBe("/tmp/spectre")
  })

  it("fills in missing fields with defaults (partial config)", () => {
    cleanConfig()
    writeTestConfig({ ssh: { user: "u", host: "h", identityFile: "/k" } })
    const config = loadConfig()
    expect(config.tunnel.localPort).toBe(DEFAULT_CONFIG.tunnel.localPort)
    expect(config.projects).toEqual({})
    expect(config.defaultExcludes).toEqual(DEFAULT_EXCLUDES)
  })
})

describe("saveConfig", () => {
  it("writes valid JSON that loadConfig can read back", () => {
    cleanConfig()
    const cfg: StudioConfig = {
      ssh: { user: "u", host: "h", identityFile: "/key" },
      tunnel: { localPort: 8000, remotePort: 8000, host: "h" },
      projects: { p1: { local: "/a", remote: "/b", excludes: [".git/"] } },
      defaultExcludes: [".git/"],
    }
    saveConfig(cfg)
    const reloaded = loadConfig()
    expect(reloaded.ssh.user).toBe("u")
    expect(reloaded.tunnel.localPort).toBe(8000)
    expect(reloaded.projects["p1"].remote).toBe("/b")
  })
})

describe("addProject", () => {
  it("adds a project", () => {
    cleanConfig()
    const cfg = loadConfig()
    const localDir = join(TMP_HOME, "my-project")
    mkdirSync(localDir, { recursive: true })
    addProject(cfg, "myproj", localDir, "/remote/myproj")
    expect(cfg.projects["myproj"]).toBeDefined()
    expect(cfg.projects["myproj"].local).toBe(localDir)
    expect(cfg.projects["myproj"].remote).toBe("/remote/myproj")
    expect(cfg.projects["myproj"].excludes).toEqual(DEFAULT_EXCLUDES)
  })

  it("accepts custom excludes", () => {
    cleanConfig()
    const cfg = loadConfig()
    const localDir = join(TMP_HOME, "proj2")
    mkdirSync(localDir, { recursive: true })
    addProject(cfg, "proj2", localDir, "/remote/p2", ["node_modules/"])
    expect(cfg.projects["proj2"].excludes).toEqual(["node_modules/"])
  })

  it("throws on non-existent local path", () => {
    cleanConfig()
    const cfg = loadConfig()
    expect(() => addProject(cfg, "ghost", "/does/not/exist", "/remote")).toThrow(
      "Local path does not exist"
    )
  })

  it("throws on duplicate project name", () => {
    cleanConfig()
    const cfg = loadConfig()
    const dir = join(TMP_HOME, "dup")
    mkdirSync(dir, { recursive: true })
    addProject(cfg, "dup", dir, "/r")
    expect(() => addProject(cfg, "dup", dir, "/r")).toThrow("already exists")
  })

  it("persists to disk", () => {
    cleanConfig()
    const cfg = loadConfig()
    const dir = join(TMP_HOME, "persist")
    mkdirSync(dir, { recursive: true })
    addProject(cfg, "persist", dir, "/r")
    const reloaded = loadConfig()
    expect(reloaded.projects["persist"]).toBeDefined()
  })
})

describe("removeProject", () => {
  it("removes a project", () => {
    cleanConfig()
    const cfg = loadConfig()
    const dir = join(TMP_HOME, "rm-me")
    mkdirSync(dir, { recursive: true })
    addProject(cfg, "rm-me", dir, "/r")
    expect(cfg.projects["rm-me"]).toBeDefined()
    removeProject(cfg, "rm-me")
    expect(cfg.projects["rm-me"]).toBeUndefined()
  })

  it("throws on missing project", () => {
    cleanConfig()
    const cfg = loadConfig()
    expect(() => removeProject(cfg, "nope")).toThrow("not found")
  })

  it("persists removal to disk", () => {
    cleanConfig()
    const cfg = loadConfig()
    const dir = join(TMP_HOME, "gone")
    mkdirSync(dir, { recursive: true })
    addProject(cfg, "gone", dir, "/r")
    removeProject(cfg, "gone")
    const reloaded = loadConfig()
    expect(reloaded.projects["gone"]).toBeUndefined()
  })
})

describe("listProjects", () => {
  it("returns all configured projects", () => {
    cleanConfig()
    const cfg = loadConfig()
    const d1 = join(TMP_HOME, "p1")
    const d2 = join(TMP_HOME, "p2")
    mkdirSync(d1, { recursive: true })
    mkdirSync(d2, { recursive: true })
    addProject(cfg, "p1", d1, "/r1")
    addProject(cfg, "p2", d2, "/r2")
    const list = listProjects(cfg)
    expect(Object.keys(list)).toHaveLength(2)
    expect(list["p1"].local).toBe(d1)
    expect(list["p2"].remote).toBe("/r2")
  })

  it("returns empty when no projects", () => {
    cleanConfig()
    const cfg = loadConfig()
    expect(listProjects(cfg)).toEqual({})
  })

  it("returns a copy, not a reference", () => {
    cleanConfig()
    const cfg = loadConfig()
    const d = join(TMP_HOME, "ref")
    mkdirSync(d, { recursive: true })
    addProject(cfg, "ref", d, "/r")
    const list = listProjects(cfg)
    delete list["ref"]
    expect(cfg.projects["ref"]).toBeDefined()
  })
})

describe("schema validation", () => {
  const validConfig: StudioConfig = {
    ssh: { user: "u", host: "h", identityFile: "/key" },
    tunnel: { localPort: 8443, remotePort: 8443, host: "h" },
    projects: {},
    defaultExcludes: [".git/"],
  }

  it("accepts a valid config", () => {
    const result = safeValidateConfig(validConfig)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ssh.user).toBe("u")
    }
  })

  it("rejects missing ssh.host", () => {
    const bad = { ...validConfig, ssh: { ...validConfig.ssh, host: "" } }
    const result = safeValidateConfig(bad)
    expect(result.success).toBe(false)
  })

  it("rejects missing identityFile", () => {
    const bad = {
      ...validConfig,
      ssh: { user: "u", host: "h" },
    }
    const result = safeValidateConfig(bad)
    expect(result.success).toBe(false)
  })

  it("rejects invalid port (0)", () => {
    const bad = { ...validConfig, tunnel: { ...validConfig.tunnel, localPort: 0 } }
    const result = safeValidateConfig(bad)
    expect(result.success).toBe(false)
  })

  it("rejects invalid port (outside range)", () => {
    const bad = { ...validConfig, tunnel: { ...validConfig.tunnel, localPort: 99999 } }
    const result = safeValidateConfig(bad)
    expect(result.success).toBe(false)
  })

  it("rejects empty tunnel host", () => {
    const bad = { ...validConfig, tunnel: { ...validConfig.tunnel, host: "" } }
    const result = safeValidateConfig(bad)
    expect(result.success).toBe(false)
  })

  it("throws on invalid config with validateConfig", () => {
    expect(() => validateConfig({})).toThrow(z.ZodError)
  })

  it("accepts config with optional SSH fields", () => {
    const withOptional: StudioConfig = {
      ssh: { user: "u", host: "h", identityFile: "/k", port: 22, strictHostChecking: true },
      tunnel: { localPort: 8443, remotePort: 8443, host: "h" },
      projects: {},
      defaultExcludes: [],
    }
    const result = safeValidateConfig(withOptional)
    expect(result.success).toBe(true)
  })
})
