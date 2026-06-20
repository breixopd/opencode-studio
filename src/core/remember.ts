import { existsSync, readFileSync, writeFileSync } from "fs"
import { studioPath, ensureStudioDirs } from "./studio-dir"

const REMEMBER_FILE = "remember.md"

function rememberPath(): string {
  return studioPath(REMEMBER_FILE)
}

export function loadRememberRules(): string[] {
  ensureStudioDirs()
  const path = rememberPath()
  if (!existsSync(path)) return []
  return readFileSync(path, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
}

export function formatRememberRules(rules: string[]): string {
  if (rules.length === 0) return ""
  return rules.map((r) => `- ${r}`).join("\n")
}

export function rememberRulesText(): string | null {
  const rules = loadRememberRules()
  if (rules.length === 0) return null
  return formatRememberRules(rules)
}

export function addRememberRule(rule: string): string[] {
  const trimmed = rule.trim()
  if (!trimmed) throw new Error("Rule must not be empty")
  const rules = loadRememberRules()
  if (!rules.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
    rules.push(trimmed)
    writeFileSync(rememberPath(), `${formatRememberRules(rules)}\n`, "utf-8")
  }
  return rules
}

export function removeRememberRule(rule: string): string[] {
  const trimmed = rule.trim().toLowerCase()
  const rules = loadRememberRules().filter((r) => r.toLowerCase() !== trimmed)
  writeFileSync(rememberPath(), rules.length ? `${formatRememberRules(rules)}\n` : "", "utf-8")
  return rules
}
