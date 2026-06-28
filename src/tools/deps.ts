import * as log from "../core/logger"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { join } from "path"

/** Extract body lines of a TOML section whose header matches the pattern.
 *  Stops at the next line starting with [ (a new section header). */
function extractTomlSection(content: string, headerPattern: RegExp): string[] {
  const lines = content.split(/\r?\n/)
  let inSection = false
  const body: string[] = []
  for (const line of lines) {
    if (headerPattern.test(line)) {
      inSection = true
      continue
    }
    if (inSection) {
      if (/^\s*\[/.test(line)) break
      body.push(line)
    }
  }
  return body
}

/**
 * studio_deps — dependency scanning and vulnerability audit.
 *
 * Uses the OSV.dev API (keyless, free) for vulnerability data.
 * Reads the project's lockfile or manifest to find dependencies.
 */
export const studio_deps: ToolDefinition = tool({
  description:
    "Dependency scanning: list deps, audit for vulnerabilities (OSV.dev, keyless), " +
      "find outdated. Reads lockfiles for any ecosystem (package.json, Cargo.toml, pyproject.toml, go.mod, etc.).",
  args: {
    action: tool.schema
      .enum(["list", "audit", "outdated"])
      .describe("list=show all deps | audit=vulnerability scan (OSV.dev) | outdated=check for updates"),
  },
  async execute(args) {
    const cwd = process.cwd()

    switch (args.action) {
      case "list": {
        return listDeps(cwd)
      }
      case "audit": {
        return await auditDeps(cwd)
      }
      case "outdated": {
        return await checkOutdated(cwd)
      }
      default:
        return `Unknown action: ${args.action}`
    }
  },
})

interface Dep {
  name: string
  version: string
  source: string
}

interface OutdatedDep {
  name: string
  current: string
  latest: string
  source: string
}

function detectDeps(root: string): Dep[] {
  const deps: Dep[] = []

  // package.json (Node/Bun)
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"))
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      deps.push({ name, version: version as string, source: "npm" })
    }
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      deps.push({ name, version: version as string, source: "npm (dev)" })
    }
  } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
    /* not a Node project */
  }

  // Cargo.toml (Rust)
  try {
    const cargo = readFileSync(join(root, "Cargo.toml"), "utf-8")
    for (const line of extractTomlSection(cargo, /^\[dependencies\]/)) {
      const m = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/)
      if (m) deps.push({ name: m[1], version: m[2], source: "crates.io" })
    }
  } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
    /* not Rust */
  }

  // pyproject.toml (Python)
  try {
    const py = readFileSync(join(root, "pyproject.toml"), "utf-8")
    for (const line of extractTomlSection(py, /^\[(project\.dependencies|tool\.poetry\.dependencies)\]/)) {
      const m = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/)
      if (m && m[1] !== "python") deps.push({ name: m[1], version: m[2], source: "pypi" })
    }
  } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
    /* not Python */
  }

  // go.mod (Go)
  try {
    const go = readFileSync(join(root, "go.mod"), "utf-8")
    for (const line of go.split("\n")) {
      const m = line.match(/^\s+([^\s]+)\s+([^\s]+)/)
      if (m && !m[1].startsWith("require") && !m[1].startsWith("//")) {
        deps.push({ name: m[1], version: m[2], source: "go modules" })
      }
    }
  } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
    /* not Go */
  }

  // Gemfile (Ruby)
  try {
    const gem = readFileSync(join(root, "Gemfile"), "utf-8")
    for (const line of gem.split("\n")) {
      const m = line.match(/^gem\s+["']([^"']+)["'](?:,\s*["']([^"']+)["'])?/)
      if (m) deps.push({ name: m[1], version: m[2] ?? "latest", source: "rubygems" })
    }
  } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
    /* not Ruby */
  }

  // composer.json (PHP)
  try {
    const composer = JSON.parse(readFileSync(join(root, "composer.json"), "utf-8"))
    for (const [name, version] of Object.entries(composer.require ?? {})) {
      if (name !== "php") deps.push({ name, version: version as string, source: "packagist" })
    }
  } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
    /* not PHP */
  }

  return deps
}

function listDeps(root: string): string {
  const deps = detectDeps(root)
  if (!deps.length) return "No dependencies found. Add a package.json, Cargo.toml, pyproject.toml, go.mod, or Gemfile."

  const bySource = new Map<string, Dep[]>()
  for (const d of deps) {
    if (!bySource.has(d.source)) bySource.set(d.source, [])
    bySource.get(d.source)!.push(d)
  }

  const lines = [`# Dependencies (${deps.length} total)`, ""]
  for (const [source, items] of bySource) {
    lines.push(`## ${source} (${items.length})`)
    for (const d of items) {
      lines.push(`- ${d.name} @ ${d.version}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

interface OSVResponse {
  vulns?: Array<{
    id: string
    summary?: string
    severity?: Array<{ type: string; score: string }>
    references?: Array<{ url: string }>
  }>
}

async function auditDeps(root: string): Promise<string> {
  const deps = detectDeps(root)
  if (!deps.length) return "No dependencies found to audit."

  const lines = [`# Vulnerability audit (${deps.length} deps)`, ""]
  let totalVulns = 0

  // OSV.dev batch query — keyless, free, rate-limited.
  const packages = deps.slice(0, 50).map((d) => {
    const pkg: Record<string, string> = { name: d.name }
    // Strip semver operators for the version query
    pkg.version = d.version.replace(/[\^~>=<]/g, "").split(" ")[0]
    if (d.source.startsWith("npm")) pkg.ecosystem = "npm"
    else if (d.source === "crates.io") pkg.ecosystem = "crates.io"
    else if (d.source === "pypi") pkg.ecosystem = "PyPI"
    else if (d.source === "packagist") pkg.ecosystem = "Packagist"
    else if (d.source === "rubygems") pkg.ecosystem = "RubyGems"
    return pkg
  })

  const queries = packages
    .filter((p) => p.version && p.version !== "latest")
    .map((p) => ({ package: p }))

  if (!queries.length) {
    return "No securable dependencies found (no versions pinned)."
  }

  try {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) return `OSV API returned ${res.status}. Try again later.`

    const data = (await res.json()) as { results?: Array<{ vulns?: OSVResponse["vulns"] }> }
    const results = data.results ?? []

    const vulnerableDeps: Array<{ name: string; version: string; vulns: string[] }> = []
    for (let i = 0; i < results.length; i++) {
      const vulns = results[i]?.vulns ?? []
      if (vulns.length > 0) {
        const pkg = queries[i].package
        vulnerableDeps.push({
          name: pkg.name,
          version: pkg.version,
          vulns: vulns.map((v) => v.id),
        })
        totalVulns += vulns.length
      }
    }

    if (totalVulns === 0) {
      lines.push("✓ No known vulnerabilities found.")
      lines.push(`Checked ${queries.length} packages against OSV.dev.`)
    } else {
      lines.push(`⚠ ${totalVulns} vulnerability(ies) in ${vulnerableDeps.length} package(s):`)
      lines.push("")
      for (const dep of vulnerableDeps) {
        lines.push(`## ${dep.name} @ ${dep.version}`)
        for (const id of dep.vulns) {
          lines.push(`- ${id} — https://osv.dev/vulnerability/${id}`)
        }
        lines.push("")
      }
      lines.push("Fix: update affected packages to patched versions. Run studio_verify after updating.")
    }

    return lines.join("\n")
  } catch (err) {
    return `Audit failed: ${(err as Error).message}. OSV.dev may be unreachable.`
  }
}

/** Query the npm registry (keyless) for the latest version of each dep. */
async function checkNpmOutdated(deps: Dep[]): Promise<OutdatedDep[]> {
  const out: OutdatedDep[] = []
  for (const dep of deps.slice(0, 50)) {
    const cleanName = dep.name.startsWith("@") ? encodeURIComponent(dep.name) : dep.name
    try {
      const res = await fetch(`https://registry.npmjs.org/${cleanName}/latest`, {
        signal: AbortSignal.timeout(5_000),
        headers: { Accept: "application/json" },
      })
      if (res.ok) {
        const data = (await res.json()) as { version: string }
        const latest = data.version
        const current = dep.version.replace(/[\^~>=<]/g, "").split(" ")[0]
        if (latest !== current && current && current !== "latest") {
          out.push({ name: dep.name, current, latest, source: "npm" })
        }
      }
    } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
      /* registry unreachable — skip this package */
    }
  }
  return out
}

/** Query crates.io (keyless, requires User-Agent header) for max stable version. */
async function checkCratesOutdated(deps: Dep[]): Promise<OutdatedDep[]> {
  const out: OutdatedDep[] = []
  for (const dep of deps.slice(0, 30)) {
    try {
      const res = await fetch(`https://crates.io/api/v1/crates/${dep.name}`, {
        signal: AbortSignal.timeout(5_000),
        headers: { "User-Agent": "opencode-studio", Accept: "application/json" },
      })
      if (res.ok) {
        const data = (await res.json()) as { crate: { max_stable_version: string } }
        const latest = data.crate.max_stable_version
        const current = dep.version.replace(/[\^~>=<]/g, "").split(" ")[0]
        if (latest !== current) out.push({ name: dep.name, current, latest, source: "crates.io" })
      }
    } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
      /* registry unreachable — skip */
    }
  }
  return out
}

/** Query PyPI (keyless) for the latest version of each dep. */
async function checkPyPIOutdated(deps: Dep[]): Promise<OutdatedDep[]> {
  const out: OutdatedDep[] = []
  for (const dep of deps.slice(0, 30)) {
    try {
      const res = await fetch(`https://pypi.org/pypi/${dep.name}/json`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (res.ok) {
        const data = (await res.json()) as { info: { version: string } }
        const latest = data.info.version
        const current = dep.version.replace(/[<>=!~^]/g, "").split(" ")[0]
        if (latest !== current) out.push({ name: dep.name, current, latest, source: "pypi" })
      }
    } catch (err) {
      log.debugCatch("src/tools/deps.ts", err);
      /* registry unreachable — skip */
    }
  }
  return out
}

/**
 * Check for outdated dependencies by querying package registry APIs.
 * Supports npm (keyless), crates.io (keyless), and PyPI (keyless).
 */
async function checkOutdated(root: string): Promise<string> {
  const deps = detectDeps(root)
  if (!deps.length) return "No dependencies found to check."

  const outdated: OutdatedDep[] = [
    ...(await checkNpmOutdated(deps.filter((d) => d.source.startsWith("npm")))),
    ...(await checkCratesOutdated(deps.filter((d) => d.source === "crates.io"))),
    ...(await checkPyPIOutdated(deps.filter((d) => d.source === "pypi"))),
  ]

  if (!outdated.length) return `✓ All ${deps.length} dependencies are up to date.`

  const lines = [`# Outdated dependencies (${outdated.length} of ${deps.length})`, ""]
  const bySource = new Map<string, OutdatedDep[]>()
  for (const o of outdated) {
    if (!bySource.has(o.source)) bySource.set(o.source, [])
    bySource.get(o.source)!.push(o)
  }
  for (const [source, items] of bySource) {
    lines.push(`## ${source}`)
    for (const o of items) lines.push(`- ${o.name}: ${o.current} → ${o.latest}`)
    lines.push("")
  }
  lines.push("Update with your package manager, then studio_verify.")
  return lines.join("\n")
}
