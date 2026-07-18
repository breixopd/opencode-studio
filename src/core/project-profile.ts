import * as log from "./logger"
import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from "fs"
import { homedir } from "os"
import { basename, join } from "path"

import type { StudioHandoff } from "./workspace-types"
import { getActiveDirectory } from "./active-dir"

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

/** Proactive polish/research/scout behaviour. Default: suggest. */
export type AutonomyMode = "full" | "suggest" | "off"

export interface UserProfile {
  globalRules: string[]
  modelMode?: ModelMode
  /** full=act on findings when idle; suggest=surface only; off=disabled */
  autonomyMode?: AutonomyMode
  /**
   * Explicit user acknowledgment of full-autonomy risks.
   * Required before setAutonomyMode("full") without acceptRisk.
   * Kept when leaving full until clearAutonomyFullRisk().
   */
  autonomyFullRiskAccepted?: boolean
  /** ISO timestamp when autonomyFullRiskAccepted was last set true */
  autonomyFullRiskAcceptedAt?: string
  pendingCatalogNotice?: string
  /** Prefer local/Ollama/LM Studio providers for fast/read-only subagents when available */
  preferLocalModels?: boolean
  /**
   * Soft/hard session spend cap in USD.
   * - `undefined` (never set) → default $5 via getSessionBudgetUsd()
   * - `null` (explicitly cleared / 0) → unlimited
   * - number > 0 → hard cap
   */
  sessionBudgetUsd?: number | null
  /**
   * Optional semantic recall via sqlite-vec (or FTS token-overlap fallback).
   * Off by default — enable with studio_preferences set_semantic_recall true.
   */
  semanticRecall?: boolean
  updatedAt: string
}

/** Error message when enabling full autonomy without risk acceptance. */
export const AUTONOMY_FULL_RISK_REQUIRED =
  'Full autonomy requires explicit risk acceptance. ' +
  'Pass accept_risk:true, run studio_preferences accept_autonomy_risk, ' +
  'or say "I accept the risk" / "accept autonomy risk".'

const AUTONOMY_FULL_RISK_TOAST = {
  variant: "warning" as const,
  title: "Full autonomy — risk accepted",
  message:
    "Remote exec may be unrestricted; agents can pass confirm:true (not host HITL). " +
    "Spend caps block tools, not LLM turns. Say \"revoke autonomy risk\" or " +
    "studio_preferences clear_autonomy_risk.",
  duration: 8000,
}

/** Default session spend cap when the user has never set one. */
export const DEFAULT_SESSION_BUDGET_USD = 5

function now(): string {
  return new Date().toISOString()
}

function ensureDirs(): void {
  mkdirSync(PROFILE_DIR, { recursive: true })
}

export function projectRoot(cwd = getActiveDirectory()): string {
  let dir = cwd
  while (dir !== "/") {
    if (existsSync(join(dir, ".git"))) {
      try {
        return realpathSync(dir)
      } catch (err) {
      log.debugCatch("src/core/project-profile.ts", err);
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
  } catch (err) {
      log.debugCatch("src/core/project-profile.ts", err);
    /* not a Node project */
  }
  // Try Cargo.toml (Rust)
  try {
    const cargo = readFileSync(join(root, "Cargo.toml"), "utf-8")
    const m = cargo.match(/^name\s*=\s*"([^"]+)"/m)
    if (m) return m[1]
  } catch (err) {
      log.debugCatch("src/core/project-profile.ts", err);
    /* not Rust */
  }
  // Try pyproject.toml (Python)
  try {
    const py = readFileSync(join(root, "pyproject.toml"), "utf-8")
    const m = py.match(/^name\s*=\s*"([^"]+)"/m)
    if (m) return m[1]
  } catch (err) {
      log.debugCatch("src/core/project-profile.ts", err);
    /* not Python */
  }
  // Try go.mod
  try {
    const go = readFileSync(join(root, "go.mod"), "utf-8")
    const m = go.match(/^module\s+(\S+)/m)
    if (m) return m[1].split("/").pop()!
  } catch (err) {
      log.debugCatch("src/core/project-profile.ts", err);
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
    autonomyMode: raw.autonomyMode,
    autonomyFullRiskAccepted: raw.autonomyFullRiskAccepted === true,
    autonomyFullRiskAcceptedAt: raw.autonomyFullRiskAcceptedAt,
    preferLocalModels: raw.preferLocalModels,
    // Preserve undefined (never set → default $5) vs null (explicitly unlimited).
    sessionBudgetUsd: Object.prototype.hasOwnProperty.call(raw, "sessionBudgetUsd")
      ? raw.sessionBudgetUsd
      : undefined,
    semanticRecall: raw.semanticRecall === true,
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

export function setAutonomyMode(
  mode: AutonomyMode,
  opts?: { acceptRisk?: boolean },
): AutonomyMode {
  if (mode === "full") {
    if (opts?.acceptRisk) {
      acceptAutonomyFullRisk()
    } else if (!hasAcceptedAutonomyFullRisk()) {
      throw new Error(AUTONOMY_FULL_RISK_REQUIRED)
    }
  }
  // Keep risk acceptance when leaving full — only clearAutonomyFullRisk() revokes it.
  const profile = loadUserProfile()
  profile.autonomyMode = mode
  saveUserProfile(profile)
  return mode
}

export function getAutonomyMode(): AutonomyMode {
  return loadUserProfile().autonomyMode ?? "suggest"
}

/** Persist full-autonomy risk acceptance and emit a TUI warning toast. */
export function acceptAutonomyFullRisk(): void {
  const profile = loadUserProfile()
  profile.autonomyFullRiskAccepted = true
  profile.autonomyFullRiskAcceptedAt = now()
  saveUserProfile(profile)
  try {
    // Lazy import avoids circular deps if toast-bus ever reads profile.
    const { emitStudioToast } = require("./toast-bus") as typeof import("./toast-bus")
    emitStudioToast(AUTONOMY_FULL_RISK_TOAST)
  } catch (err) {
    log.debugCatch("src/core/project-profile.ts:acceptAutonomyFullRisk toast", err)
  }
}

export function hasAcceptedAutonomyFullRisk(): boolean {
  return loadUserProfile().autonomyFullRiskAccepted === true
}

/** Revoke full-autonomy risk acceptance (does not change autonomyMode). */
export function clearAutonomyFullRisk(): void {
  const profile = loadUserProfile()
  profile.autonomyFullRiskAccepted = false
  delete profile.autonomyFullRiskAcceptedAt
  saveUserProfile(profile)
}

/** Natural-language risk accept / revoke from user chat. */
export function detectAutonomyRiskIntent(text: string): "accept" | "clear" | null {
  const t = text.toLowerCase()
  if (/\b(accept autonomy risk|i accept the risk|accept the risk)\b/.test(t)) {
    return "accept"
  }
  if (/\b(revoke autonomy risk|clear autonomy risk)\b/.test(t)) {
    return "clear"
  }
  return null
}

export function setPreferLocalModels(prefer: boolean): boolean {
  const profile = loadUserProfile()
  profile.preferLocalModels = prefer
  saveUserProfile(profile)
  return prefer
}

export function getPreferLocalModels(): boolean {
  return loadUserProfile().preferLocalModels ?? false
}

export function setSemanticRecall(enabled: boolean): boolean {
  const profile = loadUserProfile()
  profile.semanticRecall = enabled
  saveUserProfile(profile)
  return enabled
}

/** Semantic recall preference (default false). */
export function getSemanticRecall(): boolean {
  return loadUserProfile().semanticRecall === true
}

export function setSessionBudgetUsd(usd: number | null): number | null {
  const profile = loadUserProfile()
  if (usd == null || usd <= 0) {
    // Explicit clear → unlimited (persist null, not omit key).
    profile.sessionBudgetUsd = null
  } else {
    profile.sessionBudgetUsd = usd
  }
  saveUserProfile(profile)
  return profile.sessionBudgetUsd ?? null
}

/**
 * Effective session budget in USD.
 * Never-set (`undefined`) → default $5. Explicit null/≤0 → unlimited (`null`).
 */
export function getSessionBudgetUsd(): number | null {
  const profile = loadUserProfile()
  if (!Object.prototype.hasOwnProperty.call(profile, "sessionBudgetUsd") || profile.sessionBudgetUsd === undefined) {
    return DEFAULT_SESSION_BUDGET_USD
  }
  const v = profile.sessionBudgetUsd
  if (v == null || v <= 0) return null
  return v
}

/** True when the user has explicitly set or cleared the budget (not the $5 default). */
export function hasExplicitBudget(): boolean {
  const profile = loadUserProfile()
  return Object.prototype.hasOwnProperty.call(profile, "sessionBudgetUsd") && profile.sessionBudgetUsd !== undefined
}

/** Drop the budget key so the default $5 applies again (onboard / tests). */
export function unsetSessionBudgetUsd(): void {
  const profile = loadUserProfile()
  delete profile.sessionBudgetUsd
  saveUserProfile(profile)
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

export function loadProjectProfile(cwd = getActiveDirectory()): ProjectProfile {
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

export function touchProjectProfile(cwd = getActiveDirectory()): ProjectProfile {
  const profile = loadProjectProfile(cwd)
  profile.lastActive = now()
  saveProjectProfile(profile)
  return profile
}

export function updateProjectBrief(
  patch: Partial<Pick<ProjectProfile, "summary" | "stack" | "conventions">>,
  cwd = getActiveDirectory(),
): ProjectProfile {
  const profile = loadProjectProfile(cwd)
  if (patch.summary !== undefined) profile.summary = patch.summary
  if (patch.stack !== undefined) profile.stack = patch.stack
  if (patch.conventions !== undefined) profile.conventions = patch.conventions
  saveProjectProfile(profile)
  return profile
}

export function recordMilestone(text: string, cwd = getActiveDirectory()): ProjectProfile {
  const profile = loadProjectProfile(cwd)
  const trimmed = text.trim()
  if (trimmed && !profile.completed.includes(trimmed)) {
    profile.completed.push(trimmed)
  }
  saveProjectProfile(profile)
  return profile
}

export function syncHandoffToProfile(handoff: StudioHandoff, cwd = getActiveDirectory()): ProjectProfile {
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

export function projectContextBlock(cwd = getActiveDirectory()): string | null {
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
