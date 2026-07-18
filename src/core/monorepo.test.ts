import { describe, it, expect, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  detectMonorepoPackages,
  expandWorkspaceGlobs,
  packageForPath,
  readWorkspaceGlobs,
  buildMonorepoGraph,
  formatMonorepoGraph,
} from "./monorepo"
import { openStudioDb, closeStudioDb, runQuery } from "./studio-db"

describe("monorepo", () => {
  let root: string

  afterEach(() => {
    if (root) {
      closeStudioDb(root)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("detects package.json workspaces", () => {
    root = mkdtempSync(join(tmpdir(), "studio-mono-"))
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "root-app",
        workspaces: ["packages/*"],
      }),
    )
    mkdirSync(join(root, "packages", "a"), { recursive: true })
    mkdirSync(join(root, "packages", "b"), { recursive: true })
    writeFileSync(join(root, "packages", "a", "package.json"), JSON.stringify({ name: "@scope/a" }))
    writeFileSync(join(root, "packages", "b", "package.json"), JSON.stringify({ name: "@scope/b" }))

    const globs = readWorkspaceGlobs(root)
    expect(globs).toContain("packages/*")
    const dirs = expandWorkspaceGlobs(root, globs)
    expect(dirs).toEqual(["packages/a", "packages/b"])
    const pkgs = detectMonorepoPackages(root)
    expect(pkgs.map((p) => p.name)).toContain("@scope/a")
    expect(pkgs.map((p) => p.name)).toContain("@scope/b")
    expect(pkgs.map((p) => p.name)).toContain("root-app")
  })

  it("detects pnpm-workspace.yaml", () => {
    root = mkdtempSync(join(tmpdir(), "studio-pnpm-"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "pnpm-root" }))
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n  - 'libs/core'\n")
    mkdirSync(join(root, "apps", "web"), { recursive: true })
    mkdirSync(join(root, "libs", "core"), { recursive: true })
    writeFileSync(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "web" }))
    writeFileSync(join(root, "libs", "core", "package.json"), JSON.stringify({ name: "core" }))

    const pkgs = detectMonorepoPackages(root)
    expect(pkgs.find((p) => p.path === "apps/web")?.name).toBe("web")
    expect(pkgs.find((p) => p.path === "libs/core")?.name).toBe("core")
  })

  it("matches longest package prefix", () => {
    const packages = [
      { name: "root", path: "" },
      { name: "a", path: "packages/a" },
      { name: "nested", path: "packages/a/nested" },
    ]
    expect(packageForPath("packages/a/src/index.ts", packages)?.name).toBe("a")
    expect(packageForPath("packages/a/nested/x.ts", packages)?.name).toBe("nested")
    expect(packageForPath("README.md", packages)?.name).toBe("root")
  })

  it("counts cross-package imports from the imports table", () => {
    root = mkdtempSync(join(tmpdir(), "studio-xpkg-"))
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "mono", workspaces: ["packages/*"] }),
    )
    mkdirSync(join(root, "packages", "a", "src"), { recursive: true })
    mkdirSync(join(root, "packages", "b", "src"), { recursive: true })
    writeFileSync(join(root, "packages", "a", "package.json"), JSON.stringify({ name: "pkg-a" }))
    writeFileSync(join(root, "packages", "b", "package.json"), JSON.stringify({ name: "pkg-b" }))

    const db = openStudioDb(root)
    runQuery(
      db,
      `INSERT INTO files (path, lang, size_bytes, mtime_ns, sha256, parser, indexed_at)
       VALUES (?, 'ts', 10, 0, 'a', 'treesitter', ?)`,
      ["packages/a/src/index.ts", new Date().toISOString()],
    )
    runQuery(
      db,
      `INSERT INTO files (path, lang, size_bytes, mtime_ns, sha256, parser, indexed_at)
       VALUES (?, 'ts', 10, 0, 'b', 'treesitter', ?)`,
      ["packages/b/src/util.ts", new Date().toISOString()],
    )
    const a = db.query("SELECT id FROM files WHERE path = 'packages/a/src/index.ts'").get() as {
      id: number
    }
    const b = db.query("SELECT id FROM files WHERE path = 'packages/b/src/util.ts'").get() as {
      id: number
    }
    runQuery(
      db,
      `INSERT INTO imports (file_id, source, resolved_file_id, line, names) VALUES (?, ?, ?, 1, 'util')`,
      [a.id, "../b/src/util", b.id],
    )

    const graph = buildMonorepoGraph(root)
    expect(graph.packages.length).toBeGreaterThanOrEqual(2)
    expect(graph.crossPackageImports).toEqual([
      { fromPackage: "pkg-a", toPackage: "pkg-b", importCount: 1 },
    ])
    expect(formatMonorepoGraph(graph)).toContain("pkg-a → pkg-b: 1")
  })

  it("returns empty when not a monorepo", () => {
    root = mkdtempSync(join(tmpdir(), "studio-single-"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "solo" }))
    const graph = buildMonorepoGraph(root)
    expect(graph.packages).toEqual([])
    expect(formatMonorepoGraph(graph)).toContain("Not a monorepo")
  })
})
