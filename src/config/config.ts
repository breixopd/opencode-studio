import { homedir } from "os"
import { join, dirname } from "path"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import type { StudioConfig, ProjectMapping } from "./types"
import { DEFAULT_CONFIG, DEFAULT_EXCLUDES } from "./defaults"
import { safeValidateConfig } from "./schema"

const CONFIG_DIR = join(homedir(), ".config", "opencode-studio")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")

function mergeRawConfig(raw: Record<string, unknown>): StudioConfig {
  const remoteRaw = raw.remote as StudioConfig["remote"] | undefined
  return {
    ssh: { ...DEFAULT_CONFIG.ssh, ...((raw.ssh as object) || {}) },
    tunnel: { ...DEFAULT_CONFIG.tunnel, ...((raw.tunnel as object) || {}) },
    projects: (raw.projects as StudioConfig["projects"]) || {},
    defaultExcludes: (raw.defaultExcludes as string[]) || DEFAULT_EXCLUDES,
    ...(remoteRaw ? { remote: remoteRaw } : {}),
  }
}

function validateOrThrow(config: StudioConfig, context: string): StudioConfig {
  const result = safeValidateConfig(config)
  if (!result.success) {
    throw new Error(`Invalid studio config (${context}): ${result.error.message}`)
  }
  return result.data
}

export function loadConfig(configPath?: string): StudioConfig {
  const resolvedPath = configPath || CONFIG_PATH
  const resolvedDir = dirname(resolvedPath)

  if (!existsSync(resolvedPath)) {
    mkdirSync(resolvedDir, { recursive: true })
    // Do not auto-bind SSH from ~/.ssh/config — require studio_setup({ host }).
    const defaults = validateOrThrow(DEFAULT_CONFIG, "defaults")
    writeFileSync(resolvedPath, JSON.stringify(defaults, null, 2))
    return { ...defaults, projects: { ...defaults.projects } }
  }

  const raw = JSON.parse(readFileSync(resolvedPath, "utf-8"))
  const merged = mergeRawConfig(raw)
  const validated = validateOrThrow(merged, resolvedPath)
  return { ...validated, projects: { ...validated.projects } }
}

export function saveConfig(config: StudioConfig, configPath?: string): void {
  const validated = validateOrThrow(config, "save")
  const resolvedPath = configPath || CONFIG_PATH
  const resolvedDir = dirname(resolvedPath)
  mkdirSync(resolvedDir, { recursive: true })
  writeFileSync(resolvedPath, JSON.stringify(validated, null, 2))
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

export function updateProject(
  config: StudioConfig,
  name: string,
  patch: Partial<Pick<ProjectMapping, "remote" | "excludes" | "commitStudio">>,
  configPath?: string,
): StudioConfig {
  const project = config.projects[name]
  if (!project) {
    throw new Error(`Project '${name}' not found`)
  }
  config.projects[name] = { ...project, ...patch }
  saveConfig(config, configPath)
  return config
}

export function findProjectNameForLocal(config: StudioConfig, local: string): string | null {
  for (const [name, proj] of Object.entries(config.projects)) {
    if (local === proj.local || local.startsWith(proj.local + "/")) {
      return name
    }
  }
  return null
}

export function listProjects(config: StudioConfig): Record<string, ProjectMapping> {
  return { ...config.projects }
}
