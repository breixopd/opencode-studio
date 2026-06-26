import { relative } from "path"

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, "/").replace(/\/$/, "")
}

function basenameOf(relativePath: string): string {
  const parts = relativePath.split("/")
  return parts[parts.length - 1] ?? ""
}

function matchesPattern(relativePath: string, raw: string): boolean {
  const pattern = normalizePattern(raw)
  if (!pattern) return false

  const normalized = relativePath.replace(/\\/g, "/")
  const base = basenameOf(normalized)
  const segments = normalized.split("/")

  if (pattern.includes("*")) {
    if (pattern.startsWith("*.")) {
      return base.endsWith(pattern.slice(1))
    }
    if (pattern.endsWith("*")) {
      return base.startsWith(pattern.slice(0, -1))
    }
  }

  if (normalized === pattern || normalized.startsWith(`${pattern}/`)) return true
  return segments.includes(pattern)
}

/** Shared exclude matcher for watcher + transfers. ponytail: no glob library */
export function isExcluded(absolutePath: string, rootPath: string, patterns: string[]): boolean {
  const rel = relative(rootPath, absolutePath)
  if (rel.startsWith("..")) return false
  return patterns.some((p) => matchesPattern(rel, p))
}

export function isRelativePathExcluded(relativePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(relativePath.replace(/\\/g, "/"), p))
}
