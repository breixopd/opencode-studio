import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { detectProjectType, detectVerifyCommands, detectFormatter, detectConventions, detectTooling } from "./project-detect"

describe("project-detect", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-detect-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("detects Rust project from Cargo.toml", () => {
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "myapp"\n')
    const type = detectProjectType(dir)
    expect(type.ecosystem).toBe("Rust")
    expect(type.markers).toContain("Rust")
  })

  it("detects Python project from pyproject.toml", () => {
    writeFileSync(join(dir, "pyproject.toml"), "[tool.poetry]\nname = \"myapp\"\n")
    const type = detectProjectType(dir)
    expect(type.ecosystem).toBe("Python")
  })

  it("detects Go project from go.mod", () => {
    writeFileSync(join(dir, "go.mod"), "module github.com/user/repo\n\ngo 1.21\n")
    const type = detectProjectType(dir)
    expect(type.ecosystem).toBe("Go")
  })

  it("detects Bun project from bun.lock", () => {
    writeFileSync(join(dir, "bun.lock"), "{}")
    writeFileSync(join(dir, "package.json"), '{"name":"app","scripts":{"test":"bun test"}}')
    const type = detectProjectType(dir)
    expect(type.ecosystem).toBe("Bun")
    expect(type.confidence).toBe("high")
  })

  it("detects Java/Maven project from pom.xml", () => {
    writeFileSync(join(dir, "pom.xml"), "<project></project>")
    const type = detectProjectType(dir)
    expect(type.ecosystem).toBe("Java/Maven")
  })

  it("detects Ruby project from Gemfile", () => {
    writeFileSync(join(dir, "Gemfile"), 'source "https://rubygems.org"')
    const type = detectProjectType(dir)
    expect(type.ecosystem).toBe("Ruby")
  })

  it("returns Unknown for empty directory", () => {
    const type = detectProjectType(dir)
    expect(type.ecosystem).toBe("Unknown")
    expect(type.confidence).toBe("low")
  })

  it("detects Node verify commands as npm run <name>, not raw script bodies", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "app",
      scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc", build: "esbuild src/index.ts" },
    }))
    const cmds = detectVerifyCommands(dir, "Node")
    expect(cmds.test).toBe("npm run test")
    expect(cmds.lint).toBe("npm run lint")
    expect(cmds.typecheck).toBe("npm run typecheck")
    expect(cmds.build).toBe("npm run build")
  })

  it("prefers pnpm run when pnpm-lock.yaml is present", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "app",
      scripts: { test: "vitest", lint: "eslint ." },
    }))
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n")
    const cmds = detectVerifyCommands(dir, "Node")
    expect(cmds.test).toBe("pnpm run test")
    expect(cmds.lint).toBe("pnpm run lint")
  })

  it("prefers yarn run when yarn.lock is present", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "app",
      scripts: { test: "jest" },
    }))
    writeFileSync(join(dir, "yarn.lock"), "# yarn lockfile v1\n")
    const cmds = detectVerifyCommands(dir, "Node")
    expect(cmds.test).toBe("yarn run test")
  })

  it("detects Bun verify commands as bun run <name>", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "app",
      scripts: { test: "bun test", lint: "eslint .", build: "bun build ./src/index.ts" },
    }))
    writeFileSync(join(dir, "bun.lock"), "{}")
    const cmds = detectVerifyCommands(dir, "Bun")
    expect(cmds.test).toBe("bun run test")
    expect(cmds.lint).toBe("bun run lint")
    expect(cmds.build).toBe("bun run build")
  })

  it("detects Deno package.json scripts as deno task <name>", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "app",
      scripts: { test: "deno test", lint: "deno lint" },
    }))
    const cmds = detectVerifyCommands(dir, "Deno")
    expect(cmds.test).toBe("deno task test")
    expect(cmds.lint).toBe("deno task lint")
  })

  it("detects Deno deno.json tasks as deno task <name>, not raw bodies", () => {
    writeFileSync(join(dir, "deno.json"), JSON.stringify({
      tasks: { test: "deno test -A", build: "deno compile main.ts" },
    }))
    const cmds = detectVerifyCommands(dir, "Deno")
    expect(cmds.test).toBe("deno task test")
    expect(cmds.build).toBe("deno task build")
    expect(cmds.lint).toBe("deno lint") // default when no lint task
  })

  it("detects Rust verify commands", () => {
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "app"\n')
    const cmds = detectVerifyCommands(dir, "Rust")
    expect(cmds.test).toBe("cargo test")
    expect(cmds.lint).toBe("cargo clippy")
    expect(cmds.build).toBe("cargo build")
  })

  it("detects Go verify commands", () => {
    writeFileSync(join(dir, "go.mod"), "module app\n")
    const cmds = detectVerifyCommands(dir, "Go")
    expect(cmds.test).toBe("go test ./...")
    expect(cmds.typecheck).toBe("go vet ./...")
  })

  it("detects Python verify commands with ruff config", () => {
    writeFileSync(join(dir, "pyproject.toml"), "[tool.ruff]\nline-length = 100\n")
    const cmds = detectVerifyCommands(dir, "Python")
    expect(cmds.test).toBe("pytest")
    expect(cmds.lint).toBe("ruff check .")
  })

  it("detects Python without lint when no ruff config", () => {
    writeFileSync(join(dir, "setup.py"), "")
    const cmds = detectVerifyCommands(dir, "Python")
    expect(cmds.lint).toBeNull()
  })

  it("detects prettier formatter", () => {
    writeFileSync(join(dir, ".prettierrc"), "{}")
    const fmt = detectFormatter(dir)
    expect(fmt).toBe("prettier")
  })

  it("detects ruff formatter in pyproject.toml", () => {
    writeFileSync(join(dir, "pyproject.toml"), "[tool.ruff]\nline-length = 100\n")
    const fmt = detectFormatter(dir)
    expect(fmt).toBe("ruff format")
  })

  it("detects rustfmt", () => {
    writeFileSync(join(dir, ".rustfmt.toml"), "")
    const fmt = detectFormatter(dir)
    expect(fmt).toBe("rustfmt")
  })

  it("detects conventions including editorconfig", () => {
    writeFileSync(join(dir, ".editorconfig"), "root = true\n")
    const convs = detectConventions(dir, "Node")
    expect(convs.some((c) => c.includes("EditorConfig"))).toBe(true)
  })

  it("detectTooling returns full tooling for a Bun project", () => {
    writeFileSync(join(dir, "package.json"), '{"name":"app","scripts":{"test":"bun test"}}')
    writeFileSync(join(dir, "bun.lock"), "{}")
    writeFileSync(join(dir, ".prettierrc"), "{}")
    const tooling = detectTooling(dir)
    expect(tooling.projectType.ecosystem).toBe("Bun")
    expect(tooling.verifyCommands.test).toBe("bun run test")
    expect(tooling.formatter).toBe("prettier")
    expect(tooling.conventions.length).toBeGreaterThan(0)
  })
})
