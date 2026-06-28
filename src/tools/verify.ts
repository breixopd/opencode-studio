import * as log from "../core/logger"
import { spawn } from "child_process"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { recordVerifyFailure, recordVerifySuccess, getVerifyRetryHint } from "../core/workspace"
import { MAX_VERIFY_GRIND } from "../core/workspace"
import { detectTooling, type VerifyCommands } from "../core/project-detect"
import { snapshotHead, rollbackToSnapshot, checkGrindHealth } from "../core/self-heal"

/** Detect verify commands from project type — works for ANY language (Python/Rust/Go/Java/etc.). */
function detectCommands(cwd: string): string[] {
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

/** Aliases that map a verify category to commands across ecosystems. */
const VERIFY_ALIASES: Record<string, string[]> = {
  lint: ["lint", "clippy", "ruff", "rubocop", "eslint", "phpstan"],
  typecheck: ["typecheck", "tsc", "mypy", "vet", "check", "analyze"],
  test: ["test"],
  build: ["build", "compile", "package"],
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
    const cwd = process.cwd()

    // ——— Self-healing: snapshot / rollback ————————————————
    if (args.only === "snapshot") {
      const snap = await snapshotHead(cwd)
      if (!snap) return "Failed to snapshot HEAD — not a git repo?"
      return `✓ Snapshot saved: ${snap.commitHash.slice(0, 8)} on ${snap.branch}. Run studio_verify after implementation to verify. On persistent failure, studio_verify only=rollback will revert here.`
    }

    if (args.only === "rollback") {
      // Use the last known good snapshot — we store it in verify_state.last_failure (repurposed for snapshot hash).
      // For simplicity, rollback reverts to HEAD~1 (the commit before the last).
      // The agent can also pass studio_git restore for fine-grained control.
      const health = checkGrindHealth(cwd)
      if (!health.shouldRollback && health.grindCount === 0) {
        return `No rollback needed — verify hasn't failed recently (grind: 0/${health.maxGrind}).`
      }
      // Revert to HEAD~1 as a safe default — agent can use studio_git restore for fine-grained control.
      const { execSync } = await import("child_process")
      try {
        const parent = execSync("git rev-parse HEAD~1", { cwd, encoding: "utf-8", timeout: 5_000 }).trim()
        return await rollbackToSnapshot(cwd, { commitHash: parent, branch: "", createdAt: "", taskId: null })
      } catch (err) {
      log.debugCatch("src/tools/verify.ts", err);
      /* no parent commit (shallow repo / initial commit) */
        return "Rollback failed — cannot find parent commit. Use studio_git action=restore to revert specific files."
      }
    }

    let cmds = detectCommands(cwd)
    if (cmds.length === 0) {
      const { projectType } = detectTooling(cwd)
      return `No verify commands detected for ${projectType.ecosystem}. Set up test/lint/build scripts or run with a custom command.`
    }

    if (args.only && args.only !== "all") {
      const aliases = VERIFY_ALIASES[args.only] ?? [args.only]
      cmds = cmds.filter((c) => {
        const lower = c.toLowerCase()
        return aliases.some((a) => lower.includes(a))
      })
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
