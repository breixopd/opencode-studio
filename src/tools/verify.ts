import { spawn } from "child_process"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { recordVerifyFailure, recordVerifySuccess, getVerifyRetryHint } from "../core/workspace"
import { MAX_VERIFY_GRIND } from "../core/workspace"
import { detectTooling, type VerifyCommands } from "../core/project-detect"
import { snapshotHead, rollbackToSnapshot, loadSnapshot, checkGrindHealth } from "../core/self-heal"
import { getActiveDirectory } from "../core/active-dir"

/** Aliases that map a verify category to commands across ecosystems. */
export const VERIFY_ALIASES: Record<string, string[]> = {
  lint: ["lint", "clippy", "ruff", "rubocop", "eslint", "phpstan"],
  typecheck: ["typecheck", "tsc", "mypy", "vet", "check", "analyze"],
  test: ["test"],
  build: ["build", "compile", "package"],
}

/** Filter detected verify commands by only= category (aliases applied). */
export function filterVerifyCommands(
  cmds: string[],
  only?: string | null,
): string[] {
  if (!only || only === "all" || only === "snapshot" || only === "rollback") return cmds
  const aliases = VERIFY_ALIASES[only] ?? [only]
  return cmds.filter((c) => {
    const lower = c.toLowerCase()
    return aliases.some((a) => lower.includes(a))
  })
}

/** Detect verify commands from project type — works for ANY language (Python/Rust/Go/Java/etc.). */
export function detectCommands(cwd: string): string[] {
  const { verifyCommands } = detectTooling(cwd)
  const cmds: string[] = []
  // Filter out nulls and keep in stable order.
  const ordered: (keyof VerifyCommands)[] = ["test", "lint", "typecheck", "build"]
  for (const key of ordered) {
    const cmd = verifyCommands[key]
    if (cmd) cmds.push(cmd)
  }
  return cmds
}

function grindHint(): string {
  const hint = getVerifyRetryHint()
  if (!hint || hint.count >= MAX_VERIFY_GRIND) return ""
  return `\n\n[studio grind ${hint.count}/${MAX_VERIFY_GRIND}] Spawn @studio-implement to fix, then re-run studio_verify. Pin failure context with studio_context pin if needed.`
}

/** Error shape rejected by runCommand: a real Error carrying captured output. */
interface CommandError {
  message?: string
  stdout?: string
  stderr?: string
}

/** Run a command asynchronously, returning stdout on success or throwing on failure. */
function runCommand(cmd: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, { cwd, shell: true, timeout: timeoutMs })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else {
        reject(Object.assign(new Error(`Command failed (exit ${code})`), { stdout, stderr }))
      }
    })
  })
}

export const studio_verify: ToolDefinition = tool({
  description:
    "Run project verification: test, lint, typecheck, build. On failure, revises plan and suggests @studio-implement fix loop. " +
      "Supports snapshot (before implement) and rollback (auto-revert on persistent failure).",
  args: {
    only: tool.schema
      .enum(["test", "lint", "typecheck", "build", "all", "snapshot", "rollback"])
      .optional()
      .describe("Which check to run (default: all) | snapshot=save HEAD before work | rollback=revert to last snapshot"),
  },
  async execute(args) {
    const cwd = getActiveDirectory()

    // ——— Self-healing: snapshot / rollback ————————————————
    if (args.only === "snapshot") {
      const snap = await snapshotHead(cwd)
      if (!snap) return "Failed to snapshot HEAD — not a git repo?"
      return `✓ Snapshot saved: ${snap.commitHash.slice(0, 8)} on ${snap.branch}. Run studio_verify after implementation to verify. On persistent failure, studio_verify only=rollback will revert here.`
    }

    if (args.only === "rollback") {
      const snap = loadSnapshot(cwd)
      if (!snap) {
        return (
          "No persisted snapshot found. Run studio_verify only=snapshot before implementation, " +
          "then studio_verify only=rollback to restore that exact commit."
        )
      }
      const health = checkGrindHealth(cwd)
      if (!health.shouldRollback && health.grindCount === 0) {
        return (
          `Snapshot ${snap.commitHash.slice(0, 8)} is available, but verify hasn't failed recently ` +
          `(grind: 0/${health.maxGrind}). Pass only=rollback again after grind, or restore manually with ` +
          `studio_git action=restore ref=${snap.commitHash.slice(0, 8)}.`
        )
      }
      return await rollbackToSnapshot(cwd, snap)
    }

    let cmds = detectCommands(cwd)
    if (cmds.length === 0) {
      const { projectType } = detectTooling(cwd)
      return `No verify commands detected for ${projectType.ecosystem}. Set up test/lint/build scripts or run with a custom command.`
    }

    if (args.only && args.only !== "all") {
      cmds = filterVerifyCommands(cmds, args.only)
    }

    if (cmds.length === 0) {
      return `No matching command found for only: '${args.only ?? "all"}'.`
    }

    const results: string[] = []
    for (const cmd of cmds) {
      try {
        const out = await runCommand(cmd, cwd, 120_000)
        results.push(`✓ ${cmd}\n${out.slice(-500)}`)
      } catch (err) {
        const e = err as CommandError
        const out = e.stdout?.toString() ?? e.stderr?.toString() ?? e.message ?? "unknown error"
        const revised = recordVerifyFailure(cmd, out)
        const replan = revised
          ? "\n\n[studio] Verify failed — active plan revised. Review with studio_plan read, adjust steps, then fix and re-run studio_verify."
          : "\n\n[studio] Verify failed — create or activate a plan, then studio_plan revise with the failure details."
        return `✗ ${cmd} failed\n${out}${replan}${grindHint()}`
      }
    }

    recordVerifySuccess(cmds)
    return `${results.join("\n\n")}\n\n[studio] Verify passed — studio_handoff is now allowed.`
  },
})
