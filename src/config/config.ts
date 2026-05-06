import { homedir } from "os"
import { join, dirname } from "path"
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

export function loadConfig(configPath?: string, sshConfigPath?: string): StudioConfig {
  const resolvedPath = configPath || CONFIG_PATH
  const resolvedDir = dirname(resolvedPath)

  if (!existsSync(resolvedPath)) {
    mkdirSync(resolvedDir, { recursive: true })

    // Auto-detect from SSH config
    const hosts = parseSSHConfig(sshConfigPath)
    if (hosts.length > 0) {
      // Prefer host with identity file for key-based auth
      const first = hosts.find(h => h.identityFile && h.host) || hosts[0]
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
      writeFileSync(resolvedPath, JSON.stringify(autoConfig, null, 2))
      return { ...autoConfig, projects: { ...autoConfig.projects } }
    }

    // No SSH config detected, return empty defaults
    writeFileSync(resolvedPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
    return { ...DEFAULT_CONFIG, projects: { ...DEFAULT_CONFIG.projects } }
  }

  const raw = JSON.parse(readFileSync(resolvedPath, "utf-8"))
  return {
    ssh: { ...DEFAULT_CONFIG.ssh, ...(raw.ssh || {}) },
    tunnel: { ...DEFAULT_CONFIG.tunnel, ...(raw.tunnel || {}) },
    projects: raw.projects || {},
    defaultExcludes: raw.defaultExcludes || DEFAULT_CONFIG.defaultExcludes,
  }
}

export function saveConfig(config: StudioConfig, configPath?: string): void {
  const resolvedPath = configPath || CONFIG_PATH
  const resolvedDir = dirname(resolvedPath)
  mkdirSync(resolvedDir, { recursive: true })
  writeFileSync(resolvedPath, JSON.stringify(config, null, 2))
}

export function addProject(
  config: StudioConfig,
  name: string,
  local: string,
  remote: string,
  excludes?: string[],
  configPath?: string,
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
  saveConfig(config, configPath)
  return config
}

export function removeProject(config: StudioConfig, name: string, configPath?: string): StudioConfig {
  if (!config.projects[name]) {
    throw new Error(`Project '${name}' not found`)
  }
  delete config.projects[name]
  saveConfig(config, configPath)
  return config
}

export function listProjects(config: StudioConfig): Record<string, ProjectMapping> {
  return { ...config.projects }
}
