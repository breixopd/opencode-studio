import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from "fs"
import { homedir } from "os"
import { basename, join } from "path"

import type { StudioHandoff } from "./workspace-types"

const PROFILE_DIR = join(homedir(), ".config", "opencode-studio", "projects")
const USER_PROFILE_PATH = join(homedir(), ".config", "opencode-studio", "user.json")

export interface ProjectProfile {
  id: string
  name: string
  rootPath: string
  summary: string
  stack: string[]
  conventions: string[]
  completed: string[]
  openConcerns: string[]
  lastHandoff?: string
  lastActive: string
}

export type ModelMode = "free" | "balanced" | "quality"

export interface UserProfile {
  globalRules: string[]
  modelMode?: ModelMode
  pendingCatalogNotice?: string
  updatedAt: string
}

function now(): string {
  return new Date().toISOString()
}

function ensureDirs(): void {
  mkdirSync(PROFILE_DIR, { recursive: true })
}

export function projectRoot(cwd = process.cwd()): string {
  let dir = cwd
  while (dir !== "/") {
    if (existsSync(join(dir, ".git"))) {
      try {
        return realpathSync(dir)
      } catch {
      /* realpath failed (broken symlink/perm) — use unresolved path */
        return dir
      }
    }
    dir = join(dir, "..")
  }
  return cwd
}

export function projectIdForPath(rootPath: string): string {
  return createHash("sha256").update(rootPath).digest("hex").slice(0, 12)
}

function profilePath(id: string): string {
  return join(PROFILE_DIR, `${id}.json`)
}

function detectName(root: string): string {
  // Try package.json (Node/Bun)
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"))
    if (pkg.name && typeof pkg.name === "string") return pkg.name
  } catch {
    /* not a Node project */
  }
  // Try Cargo.toml (Rust)
  try {
    const cargo = readFileSync(join(root, "Cargo.toml"), "utf-8")
    const m = cargo.match(/^name\s*=\s*"([^"]+)"/m)
    if (m) return m[1]
  } catch {
    /* not Rust */
  }
  // Try pyproject.toml (Python)
  try {
    const py = readFileSync(join(root, "pyproject.toml"), "utf-8")
    const m = py.match(/^name\s*=\s*"([^"]+)"/m)
    if (m) return m[1]
  } catch {
    /* not Python */
  }
  // Try go.mod
  try {
    const go = readFileSync(join(root, "go.mod"), "utf-8")
    const m = go.match(/^module\s+(\S+)/m)
    if (m) return m[1].split("/").pop()!
  } catch {
    /* not Go */
  }
  return basename(root)
}

function detectStack(root: string): string[] {
  const stack: string[] = []
  const markers: Array<[string, string]> = [
    ["bun.lock", "Bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["package.json", "Node"],
    ["deno.json", "Deno"],
    ["pyproject.toml", "Python"],
    ["setup.py", "Python"],
    ["requirements.txt", "Python"],
    ["go.mod", "Go"],
    ["Cargo.toml", "Rust"],
    ["pom.xml", "Maven"],
    ["build.gradle", "Gradle"],
    ["build.gradle.kts", "Gradle"],
    ["Gemfile", "Ruby"],
    ["composer.json", "PHP"],
    ["CMakeLists.txt", "CMake"],
    ["Makefile", "Make"],
    ["mix.exs", "Elixir"],
    ["pubspec.yaml", "Dart"],
    ["Package.swift", "Swift"],
    ["docker-compose.yml", "Docker"],
    ["Dockerfile", "Docker"],
  ]
  for (const [file, label] of markers) {
    if (existsSync(join(root, file)) && !stack.includes(label)) stack.push(label)
  }
  return stack
}

export function loadUserProfile(): UserProfile {
  if (!existsSync(USER_PROFILE_PATH)) {
    return { globalRules: [], updatedAt: now() }
  }
  const raw = JSON.parse(readFileSync(USER_PROFILE_PATH, "utf-8")) as UserProfile
  return {
    globalRules: raw.globalRules ?? [],
    modelMode: raw.modelMode,
    pendingCatalogNotice: raw.pendingCatalogNotice,
    updatedAt: raw.updatedAt ?? now(),
  }
}

export function saveUserProfile(profile: UserProfile): void {
  ensureDirs()
  profile.updatedAt = now()
  writeFileSync(USER_PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8")
}

export function setModelMode(mode: ModelMode): ModelMode {
  const profile = loadUserProfile()
  profile.modelMode = mode
  saveUserProfile(profile)
  return mode
}

export function getModelMode(): ModelMode {
  return loadUserProfile().modelMode ?? "balanced"
}

export function setPendingCatalogNotice(message: string | null): void {
  const profile = loadUserProfile()
  profile.pendingCatalogNotice = message ?? undefined
  saveUserProfile(profile)
}

export function getPendingCatalogNotice(): string | null {
  return loadUserProfile().pendingCatalogNotice ?? null
}

export function addGlobalRule(rule: string): string[] {
  const profile = loadUserProfile()
  const trimmed = rule.trim()
  if (!trimmed) throw new Error("Rule must not be empty")
  if (!profile.globalRules.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
    profile.globalRules.push(trimmed)
    saveUserProfile(profile)
  }
  return profile.globalRules
}

export function loadProjectProfile(cwd = process.cwd()): ProjectProfile {
  ensureDirs()
  const root = projectRoot(cwd)
  const id = projectIdForPath(root)
  const path = profilePath(id)

  if (!existsSync(path)) {
    const created: ProjectProfile = {
      id,
      name: detectName(root),
      rootPath: root,
      summary: "",
      stack: detectStack(root),
      conventions: [],
      completed: [],
      openConcerns: [],
      lastActive: now(),
    }
    writeFileSync(path, JSON.stringify(created, null, 2), "utf-8")
    return created
  }

  const raw = JSON.parse(readFileSync(path, "utf-8")) as ProjectProfile
  return { ...raw, id, rootPath: root, stack: raw.stack?.length ? raw.stack : detectStack(root) }
}

export function saveProjectProfile(profile: ProjectProfile): void {
  ensureDirs()
  profile.lastActive = now()
  writeFileSync(profilePath(profile.id), JSON.stringify(profile, null, 2), "utf-8")
}

export function touchProjectProfile(cwd = process.cwd()): ProjectProfile {
  const profile = loadProjectProfile(cwd)
  profile.lastActive = now()
  saveProjectProfile(profile)
  return profile
}

export function updateProjectBrief(
  patch: Partial<Pick<ProjectProfile, "summary" | "stack" | "conventions">>,
  cwd = process.cwd(),
): ProjectProfile {
  const profile = loadProjectProfile(cwd)
  if (patch.summary !== undefined) profile.summary = patch.summary
  if (patch.stack !== undefined) profile.stack = patch.stack
  if (patch.conventions !== undefined) profile.conventions = patch.conventions
  saveProjectProfile(profile)
  return profile
}

export function recordMilestone(text: string, cwd = process.cwd()): ProjectProfile {
  const profile = loadProjectProfile(cwd)
  const trimmed = text.trim()
  if (trimmed && !profile.completed.includes(trimmed)) {
    profile.completed.push(trimmed)
  }
  saveProjectProfile(profile)
  return profile
}

export function syncHandoffToProfile(handoff: StudioHandoff, cwd = process.cwd()): ProjectProfile {
  const profile = loadProjectProfile(cwd)
  profile.lastHandoff = handoff.summary
  profile.lastActive = now()

  if (handoff.summary && !profile.completed.includes(handoff.summary)) {
    profile.completed.push(handoff.summary)
    if (profile.completed.length > 20) profile.completed = profile.completed.slice(-20)
  }

  const concern = [handoff.risks, handoff.nextSteps].filter(Boolean).join(" — ")
  if (concern) {
    profile.openConcerns.push(concern)
    if (profile.openConcerns.length > 10) profile.openConcerns = profile.openConcerns.slice(-10)
  }

  saveProjectProfile(profile)
  return profile
}

export function projectContextBlock(cwd = process.cwd()): string | null {
  const profile = loadProjectProfile(cwd)
  const user = loadUserProfile()
  const parts: string[] = []

  if (user.globalRules.length) {
    parts.push("[studio user] Global rules:\n" + user.globalRules.map((r) => `- ${r}`).join("\n"))
  }

  const lines: string[] = [`Project: ${profile.name} (${profile.rootPath})`]
  if (profile.summary) lines.push(`About: ${profile.summary}`)
  if (profile.stack.length) lines.push(`Stack: ${profile.stack.join(", ")}`)
  if (profile.conventions.length) {
    lines.push("Conventions:\n" + profile.conventions.map((c) => `- ${c}`).join("\n"))
  }
  if (profile.completed.length) {
    const recent = profile.completed.slice(-5)
    lines.push("Recently completed:\n" + recent.map((c) => `- ${c}`).join("\n"))
  }
  if (profile.openConcerns.length) {
    const recent = profile.openConcerns.slice(-3)
    lines.push("Open concerns:\n" + recent.map((c) => `- ${c}`).join("\n"))
  }
  if (profile.lastHandoff) lines.push(`Last handoff: ${profile.lastHandoff}`)

  if (lines.length > 1 || profile.summary) {
    parts.push("[studio project] Cross-session context:\n" + lines.join("\n"))
  }

  return parts.length ? parts.join("\n\n") : null
}
