import { homedir } from "os"
import { join } from "path"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import type { StudioConfig, ProjectMapping } from "./types"
import { DEFAULT_CONFIG, DEFAULT_EXCLUDES } from "./defaults"
import { parseSSHConfig } from "./ssh-config"

const CONFIG_DIR = join(homedir(), ".config", "opencode-studio")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function getConfigDir(): string {
  return CONFIG_DIR
}

export function loadConfig(): StudioConfig {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(CONFIG_DIR, { recursive: true })

    // Auto-detect from SSH config
    const hosts = parseSSHConfig()
    if (hosts.length > 0) {
      const first = hosts[0]
      const autoConfig: StudioConfig = {
        ssh: {
          user: first.user || "",
          host: first.host || first.alias,
          identityFile: first.identityFile || "",
        },
        tunnel: {
          ...DEFAULT_CONFIG.tunnel,
          host: first.host || first.alias,
        },
        projects: {},
        defaultExcludes: DEFAULT_EXCLUDES,
      }
      writeFileSync(CONFIG_PATH, JSON.stringify(autoConfig, null, 2))
      return { ...autoConfig, projects: { ...autoConfig.projects } }
    }

    // No SSH config detected, return empty defaults
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2))
    return { ...DEFAULT_CONFIG, projects: { ...DEFAULT_CONFIG.projects } }
  }

  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
  return {
    ssh: { ...DEFAULT_CONFIG.ssh, ...(raw.ssh || {}) },
    tunnel: { ...DEFAULT_CONFIG.tunnel, ...(raw.tunnel || {}) },
    projects: raw.projects || {},
    defaultExcludes: raw.defaultExcludes || DEFAULT_CONFIG.defaultExcludes,
  }
}

export function saveConfig(config: StudioConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function addProject(
  config: StudioConfig,
  name: string,
  local: string,
  remote: string,
  excludes?: string[]
): StudioConfig {
  if (!existsSync(local)) {
    throw new Error(`Local path does not exist: ${local}`)
  }
  if (config.projects[name]) {
    throw new Error(`Project '${name}' already exists`)
  }
  config.projects[name] = {
    local,
    remote,
    excludes: excludes || [...config.defaultExcludes],
  }
  saveConfig(config)
  return config
}

export function removeProject(config: StudioConfig, name: string): StudioConfig {
  if (!config.projects[name]) {
    throw new Error(`Project '${name}' not found`)
  }
  delete config.projects[name]
  saveConfig(config)
  return config
}

export function listProjects(config: StudioConfig): Record<string, ProjectMapping> {
  return { ...config.projects }
}
