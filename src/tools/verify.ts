import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"

function detectCommands(cwd: string): string[] {
  const pkgPath = join(cwd, "package.json")
  if (!existsSync(pkgPath)) return []
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
  const scripts = pkg.scripts ?? {}
  const cmds: string[] = []
  if (scripts.test) cmds.push(detectRunner(cwd, "test"))
  if (scripts.lint) cmds.push(detectRunner(cwd, "lint"))
  if (scripts.typecheck) cmds.push(detectRunner(cwd, "typecheck"))
  if (scripts.build) cmds.push(detectRunner(cwd, "build"))
  return cmds
}

function detectRunner(cwd: string, script: string): string {
  if (existsSync(join(cwd, "bun.lock"))) return `bun run ${script}`
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return `pnpm run ${script}`
  return `npm run ${script}`
}

export const studio_verify: ToolDefinition = tool({
  description:
    "Run project verification: test, lint, typecheck, build (auto-detected from package.json). Use before marking work done.",
  args: {
    only: tool.schema
      .enum(["test", "lint", "typecheck", "build", "all"])
      .optional()
      .describe("Which check to run (default: all detected)"),
  },
  async execute(args) {
    const cwd = process.cwd()
    let cmds = detectCommands(cwd)
    if (cmds.length === 0) return "No package.json scripts found for test/lint/typecheck/build."

    if (args.only && args.only !== "all") {
      cmds = cmds.filter((c) => c.includes(`run ${args.only}`))
    }

    const results: string[] = []
    for (const cmd of cmds) {
      try {
        const out = execSync(cmd, { cwd, encoding: "utf-8", timeout: 120_000 })
        results.push(`✓ ${cmd}\n${out.slice(-500)}`)
      } catch (err: any) {
        const out = err.stdout?.toString() ?? err.message
        return `✗ ${cmd} failed\n${out}`
      }
    }
    return results.join("\n\n")
  },
})
