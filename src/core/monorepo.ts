/**
 * Lightweight monorepo detection + cross-package import counts.
 *
 * Detects npm/yarn/bun workspaces (package.json) and pnpm-workspace.yaml.
 * Cross-package edges come from the existing imports table when resolved
 * paths cross package boundaries — no separate DBs.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"
import { openStudioDb, queryAll } from "./studio-db"
import * as log from "./logger"

export interface MonorepoPackage {
  name: string
  /** Path relative to repo root ("" for root package). */
  path: string
}

export interface CrossPackageEdge {
  fromPackage: string
  toPackage: string
  importCount: number
}

export interface MonorepoGraph {
  root: string
  packages: MonorepoPackage[]
  crossPackageImports: CrossPackageEdge[]
}

type WorkspaceGlobs = string[]

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>
  } catch (err) {
    log.debugCatch("src/core/monorepo.ts", err)
    return null
  }
}

/** Extract workspace glob patterns from package.json / pnpm-workspace.yaml. */
export function readWorkspaceGlobs(root: string): WorkspaceGlobs {
  const globs: string[] = []

  const pkgPath = join(root, "package.json")
  if (existsSync(pkgPath)) {
    const pkg = readJsonSafe(pkgPath)
    const ws = pkg?.workspaces
    if (Array.isArray(ws)) {
      for (const g of ws) if (typeof g === "string") globs.push(g)
    } else if (ws && typeof ws === "object" && Array.isArray((ws as { packages?: unknown }).packages)) {
      for (const g of (ws as { packages: unknown[] }).packages) {
        if (typeof g === "string") globs.push(g)
      }
    }
  }

  const pnpmPath = join(root, "pnpm-workspace.yaml")
  if (existsSync(pnpmPath)) {
    try {
      const text = readFileSync(pnpmPath, "utf-8")
      // Minimal YAML: lines under `packages:` that look like `- 'foo/*'` or `- foo/*`
      let inPackages = false
      for (const line of text.split("\n")) {
        if (/^\s*packages\s*:/.test(line)) {
          inPackages = true
          continue
        }
        if (inPackages) {
          if (/^\S/.test(line) && !line.trim().startsWith("#")) break
          const m = line.match(/^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*$/)
          if (m?.[1]) globs.push(m[1].trim())
        }
      }
    } catch (err) {
      log.debugCatch("src/core/monorepo.ts", err)
    }
  }

  return [...new Set(globs)]
}

/**
 * Expand simple workspace globs (`packages/*`, `apps/*`) to concrete dirs
 * that contain a package.json. Does not support `**` or negation.
 */
export function expandWorkspaceGlobs(root: string, globs: string[]): string[] {
  const dirs: string[] = []
  for (const pattern of globs) {
    const normalized = pattern.replace(/\/$/, "")
    if (normalized.includes("**") || normalized.startsWith("!")) continue

    if (normalized.endsWith("/*")) {
      const parent = join(root, normalized.slice(0, -2))
      if (!existsSync(parent)) continue
      let entries: string[]
      try {
        entries = readdirSync(parent)
      } catch (err) {
        log.debugCatch("src/core/monorepo.ts", err)
        continue
      }
      for (const name of entries) {
        const abs = join(parent, name)
        try {
          if (!statSync(abs).isDirectory()) continue
        } catch {
          continue
        }
        if (existsSync(join(abs, "package.json"))) {
          dirs.push(relative(root, abs).replace(/\\/g, "/"))
        }
      }
      continue
    }

    const abs = join(root, normalized)
    if (existsSync(join(abs, "package.json"))) {
      dirs.push(normalized.replace(/\\/g, "/"))
    }
  }
  return [...new Set(dirs)].sort()
}

function packageNameAt(root: string, relDir: string): string {
  const pkgPath = join(root, relDir, "package.json")
  const pkg = readJsonSafe(pkgPath)
  if (typeof pkg?.name === "string" && pkg.name) return pkg.name
  return relDir || "(root)"
}

/** List workspace package roots (empty if not a monorepo). */
export function detectMonorepoPackages(root: string): MonorepoPackage[] {
  const globs = readWorkspaceGlobs(root)
  if (!globs.length) return []

  const dirs = expandWorkspaceGlobs(root, globs)
  const packages: MonorepoPackage[] = dirs.map((path) => ({
    name: packageNameAt(root, path),
    path,
  }))

  // Include root package if it has a name and isn't already listed
  if (existsSync(join(root, "package.json"))) {
    const rootName = packageNameAt(root, "")
    if (rootName !== "(root)" && !packages.some((p) => p.path === "")) {
      packages.unshift({ name: rootName, path: "" })
    }
  }

  return packages
}

/** Longest-prefix package match for a repo-relative file path. */
export function packageForPath(
  filePath: string,
  packages: MonorepoPackage[],
): MonorepoPackage | null {
  const norm = filePath.replace(/\\/g, "/")
  let best: MonorepoPackage | null = null
  for (const pkg of packages) {
    if (!pkg.path) continue
    if (norm === pkg.path || norm.startsWith(pkg.path + "/")) {
      if (!best || pkg.path.length > best.path.length) best = pkg
    }
  }
  if (best) return best
  return packages.find((p) => p.path === "") ?? null
}

/**
 * Packages + cross-package import counts from the existing imports table
 * (resolved_file_id links only).
 */
export function buildMonorepoGraph(root: string): MonorepoGraph {
  const packages = detectMonorepoPackages(root)
  if (!packages.length) {
    return { root, packages: [], crossPackageImports: [] }
  }

  const db = openStudioDb(root)
  const rows = queryAll<{ importer: string; target: string }>(
    db,
    `SELECT importer.path AS importer, target.path AS target
     FROM imports i
     JOIN files importer ON importer.id = i.file_id
     JOIN files target ON target.id = i.resolved_file_id
     WHERE i.resolved_file_id IS NOT NULL`,
  )

  const counts = new Map<string, number>()
  for (const row of rows) {
    const from = packageForPath(row.importer, packages)
    const to = packageForPath(row.target, packages)
    if (!from || !to || from.path === to.path) continue
    const key = `${from.name}\0${to.name}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const crossPackageImports: CrossPackageEdge[] = [...counts.entries()]
    .map(([key, importCount]) => {
      const [fromPackage, toPackage] = key.split("\0")
      return { fromPackage: fromPackage!, toPackage: toPackage!, importCount }
    })
    .sort((a, b) => b.importCount - a.importCount || a.fromPackage.localeCompare(b.fromPackage))

  return { root, packages, crossPackageImports }
}

/** Human-readable summary for studio_index action=monorepo. */
export function formatMonorepoGraph(graph: MonorepoGraph): string {
  if (!graph.packages.length) {
    return "Not a monorepo (no package.json workspaces / pnpm-workspace.yaml found)."
  }
  const lines = [
    `Monorepo packages (${graph.packages.length}):`,
    ...graph.packages.map((p) => `  ${p.name} — ${p.path || "."}`),
  ]
  if (!graph.crossPackageImports.length) {
    lines.push("", "No cross-package imports (index may need rebuild, or imports are unresolved).")
  } else {
    lines.push("", "Cross-package imports:")
    for (const e of graph.crossPackageImports) {
      lines.push(`  ${e.fromPackage} → ${e.toPackage}: ${e.importCount}`)
    }
  }
  return lines.join("\n")
}
