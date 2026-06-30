/**
 * Git worktree isolation — creates real git worktrees so multiple
 * @studio-implement agents can work without colliding on the same files.
 *
 * A worktree is a separate working directory linked to the same git repo.
 * Each worktree gets its own branch, so parallel agents can edit different
 * files without merge conflicts.
 */
import { spawn } from "child_process"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import * as log from "./logger"

/** Run a git command, returning trimmed stdout. */
function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, timeout: 10_000 })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`))
    })
  })
}

export interface Worktree {
  path: string
  branch: string
  createdAt: string
}

const WORKTREE_DIR = ".studio/worktrees"

/**
 * Create a new git worktree with a dedicated branch.
 * The worktree lives at `.studio/worktrees/<name>` — ignored by .gitignore.
 */
export async function createWorktree(
  root: string,
  name: string,
  baseBranch?: string,
): Promise<Worktree> {
  const wtDir = join(root, WORKTREE_DIR)
  if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })

  const branchName = `studio/${name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/\.\./g, "_")}`
  const wtPath = join(wtDir, name)

  // Create branch (from base if specified, else from HEAD) and worktree.
  const base = baseBranch ?? (await git(["rev-parse", "--abbrev-ref", "HEAD"], root))
  await git(["worktree", "add", "-b", branchName, wtPath, base], root)

  const wt: Worktree = {
    path: wtPath,
    branch: branchName,
    createdAt: new Date().toISOString(),
  }
  log.info(`Worktree created: ${wtPath} on branch ${branchName}`)
  return wt
}

/** Remove a worktree and optionally delete its branch. */
export async function removeWorktree(root: string, wt: Worktree, deleteBranch = true): Promise<void> {
  try {
    await git(["worktree", "remove", "--force", wt.path], root)
    if (deleteBranch) {
      await git(["branch", "-D", wt.branch], root)
    }
    log.info(`Worktree removed: ${wt.path}`)
  } catch (err) {
    log.error(`Worktree removal failed: ${(err as Error).message}`)
  }
}

/** List all studio worktrees. */
export async function listWorktrees(root: string): Promise<Worktree[]> {
  try {
    const out = await git(["worktree", "list", "--porcelain"], root)
    const worktrees: Worktree[] = []
    let currentPath = ""
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice(9)
      } else if (line.startsWith("branch ") && currentPath.includes(WORKTREE_DIR)) {
        worktrees.push({
          path: currentPath,
          branch: line.slice(7),
          createdAt: "",
        })
      }
    }
    return worktrees
  } catch (err) {
      log.debugCatch("src/core/worktree.ts", err);
    return []
  }
}

/** Merge a worktree's branch back into the current branch. */
export async function mergeWorktree(root: string, wt: Worktree): Promise<string> {
  try {
    await git(["merge", "--no-ff", wt.branch, "-m", `merge: studio worktree ${wt.branch}`], root)
    log.info(`Merged worktree branch ${wt.branch}`)
    return `✓ Merged ${wt.branch} into current branch. Run studio_verify after.`
  } catch (err) {
    return `✗ Merge failed: ${(err as Error).message}. Resolve conflicts manually: git merge --abort or git mergetool.`
  }
}
