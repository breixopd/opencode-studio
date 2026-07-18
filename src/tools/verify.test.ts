import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { detectTooling } from "../core/project-detect"
import {
  VERIFY_ALIASES,
  detectCommands,
  filterVerifyCommands,
} from "./verify"

describe("studio_verify helpers", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-verify-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("VERIFY_ALIASES cover lint/typecheck/test/build ecosystems", () => {
    expect(VERIFY_ALIASES.lint).toContain("eslint")
    expect(VERIFY_ALIASES.lint).toContain("ruff")
    expect(VERIFY_ALIASES.typecheck).toContain("tsc")
    expect(VERIFY_ALIASES.typecheck).toContain("mypy")
    expect(VERIFY_ALIASES.test).toEqual(["test"])
    expect(VERIFY_ALIASES.build).toContain("compile")
  })

  it("detectTooling + detectCommands integrate for Bun package.json", () => {
    writeFileSync(join(dir, "bun.lock"), "{}")
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "app",
        scripts: {
          test: "bun test",
          lint: "eslint .",
          typecheck: "tsc --noEmit",
          build: "bun build ./src/index.ts",
        },
      }),
    )
    const tooling = detectTooling(dir)
    expect(tooling.projectType.ecosystem).toBe("Bun")
    const cmds = detectCommands(dir)
    expect(cmds).toContain("bun run test")
    expect(cmds).toContain("bun run lint")
    expect(cmds).toContain("bun run typecheck")
    expect(cmds).toContain("bun run build")
    // Never surface raw script bodies
    expect(cmds.some((c) => c === "eslint ." || c === "bun test")).toBe(false)
  })

  it("filterVerifyCommands applies aliases for only=lint", () => {
    const cmds = ["bun test", "eslint src", "tsc --noEmit", "bun run build"]
    expect(filterVerifyCommands(cmds, "lint")).toEqual(["eslint src"])
    expect(filterVerifyCommands(cmds, "typecheck")).toEqual(["tsc --noEmit"])
    expect(filterVerifyCommands(cmds, "test")).toEqual(["bun test"])
    expect(filterVerifyCommands(cmds, "all")).toEqual(cmds)
  })

  it("filterVerifyCommands matches clippy via lint aliases", () => {
    expect(filterVerifyCommands(["cargo clippy", "cargo test"], "lint")).toEqual(["cargo clippy"])
  })
})
