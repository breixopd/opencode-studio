import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { recordVerifyFailure } from "../core/workspace"
import { getActiveDirectory } from "../core/active-dir"
import { gitExec as git } from "../core/git-exec"
import { gh } from "../core/ci-watcher"
import { resolveGitHubAuth } from "../core/github-auth"

const MAX_DIFF_CHARS = 8000
const MAX_LOG_LINES = 30

/** Env so git HTTPS / gh credential helper can use the same system login. */
async function gitRemoteEnv(): Promise<NodeJS.ProcessEnv> {
  const { token, source } = await resolveGitHubAuth()
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  if (token && source !== "GH_TOKEN" && !env.GH_TOKEN) env.GH_TOKEN = token
  if (token && source !== "GITHUB_TOKEN" && !env.GITHUB_TOKEN) env.GITHUB_TOKEN = token
  return env
}

export const studio_git: ToolDefinition = tool({
  description:
    "Git management: status, diff, log, blame, commit, stage, stash, branch, restore, push/pull, and GitHub PRs via `gh`. " +
      "Remote ops use GITHUB_TOKEN / GH_TOKEN / `gh auth` system login. Parsed, token-cheap output — not raw git.",
  args: {
    action: tool.schema
      .enum([
        "status",
        "diff",
        "staged_diff",
        "log",
        "blame",
        "commit",
        "stage",
        "unstage",
        "stash",
        "branch_create",
        "branch_switch",
        "branch_list",
        "restore",
        "show",
        "push",
        "pull",
        "pr_create",
        "pr_view",
        "pr_list",
      ])
      .describe("Git action to perform"),
    files: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("File paths (for stage, unstage, restore, diff)"),
    message: tool.schema
      .string()
      .optional()
      .describe("Commit message (for commit) or PR body (for pr_create). If omitted for commit, auto-generated from staged diff."),
    ref: tool.schema
      .string()
      .optional()
      .describe("Git ref — commit hash, branch name, or HEAD~N (for log, show, restore, branch_switch, push)"),
    line_start: tool.schema
      .number()
      .optional()
      .describe("Start line for blame"),
    title: tool.schema
      .string()
      .optional()
      .describe("PR title (for pr_create)"),
  },
  async execute(args) {
    const cwd = getActiveDirectory()

    try {
      // Reject refs that look like git options to prevent argument injection
      if (args.ref && args.ref.startsWith("-")) {
        return `✗ invalid ref "${args.ref}": refs must not start with "-" (prevents git option injection)`
      }

      switch (args.action) {
        // ——— Read ops ————————————————

        case "status": {
          const out = await git(["status", "--porcelain=v2", "--branch"], cwd)
          const lines = out.split("\n")
          const branch = lines.find((l) => l.startsWith("# branch.head"))?.split(" ")[2] ?? "unknown"
          const staged: string[] = []
          const unstaged: string[] = []
          const untracked: string[] = []
          for (const l of lines) {
            if (l.startsWith("#") || !l) continue
            if (l.startsWith("1 ")) {
              const fields = l.split(" ")
              const xy = fields[1]
              const file = fields[fields.length - 1]
              if (xy[0] !== ".") staged.push(file)
              if (xy[1] !== ".") unstaged.push(file)
            } else if (l.startsWith("2 ")) {
              const fields = l.split(" ")
              const xy = fields[1]
              const file = l.split("\t")[1] ?? fields[fields.length - 1]
              if (xy[0] !== ".") staged.push(file)
              if (xy[1] !== ".") unstaged.push(file)
            } else if (l.startsWith("? ")) {
              untracked.push(l.slice(2))
            }
          }
          const parts = [`Branch: ${branch}`]
          if (staged.length) parts.push(`Staged (${staged.length}):\n${staged.map((f) => `  + ${f}`).join("\n")}`)
          if (unstaged.length) parts.push(`Modified (${unstaged.length}):\n${unstaged.map((f) => `  ~ ${f}`).join("\n")}`)
          if (untracked.length) parts.push(`Untracked (${untracked.length}):\n${untracked.map((f) => `  ? ${f}`).join("\n")}`)
          if (parts.length === 1) parts.push("Working tree clean.")
          return parts.join("\n\n")
        }

        case "diff": {
          const diffArgs = ["diff"]
          if (args.files?.length) diffArgs.push("--", ...args.files)
          const out = await git(diffArgs, cwd)
          if (!out) return "No unstaged changes."
          return out.length > MAX_DIFF_CHARS ? `${out.slice(0, MAX_DIFF_CHARS)}\n\n… [${out.length - MAX_DIFF_CHARS} chars truncated — stage and use staged_diff for more]` : out
        }

        case "staged_diff": {
          const out = await git(["diff", "--cached"], cwd)
          if (!out) return "No staged changes."
          return out.length > MAX_DIFF_CHARS ? `${out.slice(0, MAX_DIFF_CHARS)}\n\n… [${out.length - MAX_DIFF_CHARS} chars truncated]` : out
        }

        case "log": {
          const ref = args.ref ?? "HEAD"
          const out = await git(
            ["log", ref, `--format=%h|%an|%ar|%s`, `-${MAX_LOG_LINES}`],
            cwd,
          )
          if (!out) return `No commits found for ${ref}.`
          const lines = out.split("\n").map((l) => {
            const [hash, author, date, ...subj] = l.split("|")
            return `${hash} ${subj.join("|")} (${author}, ${date})`
          })
          return `Recent commits (${lines.length}):\n${lines.join("\n")}`
        }

        case "blame": {
          if (!args.files?.[0]) return "files[0] required for blame"
          const file = args.files[0]
          const out = await git(
            ["blame", "-L", `${args.line_start ?? 1},+20`, "--", file],
            cwd,
          )
          const lines = out
            .split("\n")
            .slice(0, 20)
            .map((l) => {
              // Default blame format: <hash> (<author> <date>) <line>
              const m = l.match(/^([0-9a-f]+)\s+\(([^)]+)\)\s+(.*)$/)
              if (!m) return l.slice(0, 100)
              return `${m[1].slice(0, 8)} (${m[2].slice(0, 30)}) ${m[3].slice(0, 60)}`
            })
          return `Blame ${file}:${args.line_start ?? 1}:\n${lines.join("\n")}`
        }

        case "show": {
          if (!args.ref) return "ref required (commit hash or ref) for show"
          const out = await git(["show", args.ref, "--stat", "--format=%H%n%an%n%ar%n%s%n%n%b"], cwd)
          return out.length > MAX_DIFF_CHARS ? `${out.slice(0, MAX_DIFF_CHARS)}\n\n… [truncated]` : out
        }

        // ——— Write ops ————————————————

        case "stage": {
          if (!args.files?.length) return "files required for stage"
          await git(["add", "--", ...args.files], cwd)
          return `Staged ${args.files.length} file(s): ${args.files.join(", ")}`
        }

        case "unstage": {
          if (!args.files?.length) return "files required for unstage"
          await git(["restore", "--staged", "--", ...args.files], cwd)
          return `Unstaged ${args.files.length} file(s): ${args.files.join(", ")}`
        }

        case "commit": {
          // Get staged diff to auto-generate message if not provided.
          const staged = await git(["diff", "--cached", "--stat"], cwd)
          if (!staged) return "Nothing staged to commit. Use studio_git action=stage first."

          let msg = args.message?.trim()
          if (!msg) {
            // Auto-generate conventional commit message from staged diff stats.
            // `git diff --cached --stat` prints "<path> | <changes>" per file,
            // plus a trailing "N files changed" summary. Take the path (before " |")
            // and explicitly drop the summary line.
            const files = staged
              .split("\n")
              .map((l) => l.split(" |")[0].trim())
              .filter((p) => p.length > 0 && !/files? changed/.test(p))
            const fileSummary = files.slice(0, 5).join(", ")
            const scope = inferScope(files)
            msg = scope
              ? `feat(${scope}): update ${files.length} file(s) — ${fileSummary.slice(0, 80)}`
              : `feat: update ${files.length} file(s) — ${fileSummary.slice(0, 80)}`
          }

          await git(["commit", "-m", msg], cwd)
          const newHash = await git(["rev-parse", "--short", "HEAD"], cwd)
          return `Committed ${newHash}: ${msg}`
        }

        case "stash": {
          await git(["stash", "push", "-m", args.message ?? "studio-auto-stash"], cwd)
          return "Changes stashed. Use `git stash pop` to restore."
        }

        case "branch_create": {
          if (!args.ref) return "ref required (new branch name) for branch_create"
          await git(["checkout", "-b", args.ref], cwd)
          return `Created and switched to branch: ${args.ref}`
        }

        case "branch_switch": {
          if (!args.ref) return "ref required (branch name) for branch_switch"
          await git(["checkout", args.ref], cwd)
          return `Switched to branch: ${args.ref}`
        }

        case "branch_list": {
          const out = await git(["branch", "-a", "--format=%(refname:short) %(objectname:short) %(committerdate:relative)"], cwd)
          const current = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
          const lines = out.split("\n").map((l) => {
            const name = l.split(" ")[0]
            return name === current ? `* ${l}` : `  ${l}`
          })
          return `Branches:\n${lines.join("\n")}`
        }

        case "restore": {
          // Restore/rollback: restore files to HEAD state, or to a specific ref.
          if (!args.files?.length && !args.ref) return "files or ref required for restore"
          if (args.ref) {
            // Rollback to a specific commit (soft — keeps working changes).
            await git(["restore", "--source", args.ref, "--", ...(args.files ?? ["."])], cwd)
            return `Restored ${args.files?.length ?? "all"} file(s) to ${args.ref}`
          }
          const filesToRestore = args.files ?? ["."]
          await git(["restore", "--", ...filesToRestore], cwd)
          return `Restored ${filesToRestore.length} file(s) to HEAD`
        }

        // ——— Remote / GitHub (system auth via gh / tokens) ———

        case "push": {
          const env = await gitRemoteEnv()
          const ref = args.ref ?? "HEAD"
          const out = await git(["push", "-u", "origin", ref], cwd, 60_000, env)
          return out || `Pushed ${ref} to origin (uses gh auth / GITHUB_TOKEN / credential helper).`
        }

        case "pull": {
          const env = await gitRemoteEnv()
          const out = await git(["pull", "--ff-only"], cwd, 60_000, env)
          return out || "Already up to date."
        }

        case "pr_create": {
          const title = args.title?.trim()
          const body = args.message?.trim()
          if (!title && !body) return "title or message required for pr_create"
          const ghArgs = ["pr", "create"]
          if (title) ghArgs.push("--title", title)
          if (body) ghArgs.push("--body", body)
          // Fill any omitted fields from commits / branch.
          if (!title || !body) ghArgs.push("--fill")
          try {
            const out = await gh(ghArgs, cwd, 60_000)
            return out || "PR created."
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return `✗ pr_create failed: ${msg.slice(0, 2000)}\nHint: run \`gh auth login\` (or set GITHUB_TOKEN).`
          }
        }

        case "pr_view": {
          try {
            const out = await gh(
              ["pr", "view", "--json", "number,title,url,state,isDraft,headRefName,baseRefName,body", "--jq",
                '"#\\(.number) \\(.title)\\n\\(.url)\\n\\(.state) draft=\\(.isDraft) \\(.headRefName) → \\(.baseRefName)\\n\\n\\(.body // "")"'],
              cwd,
              30_000,
            )
            return out || "No open PR for this branch."
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return `✗ pr_view failed: ${msg.slice(0, 2000)}\nHint: run \`gh auth login\`.`
          }
        }

        case "pr_list": {
          try {
            const out = await gh(
              ["pr", "list", "--limit", "10", "--json", "number,title,url,headRefName",
                "--jq", '.[] | "#\\(.number) \\(.title) (\\(.headRefName))\\n  \\(.url)"'],
              cwd,
              30_000,
            )
            return out || "No open pull requests."
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return `✗ pr_list failed: ${msg.slice(0, 2000)}\nHint: run \`gh auth login\`.`
          }
        }

        default:
          return `Unknown action: ${args.action}`
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // If this looks like a verify-adjacent failure, record it.
      if (args.action === "commit" && msg.includes("pre-commit")) {
        recordVerifyFailure("git commit (pre-commit hook)", msg)
      }
      return `✗ git ${args.action} failed: ${msg.slice(0, 4000)}`
    }
  },
})

/** Infer a conventional commit scope from changed file paths. */
function inferScope(files: string[]): string | null {
  if (!files.length) return null
  // Find common directory prefix.
  const dirs = files.map((f) => f.split("/").slice(0, -1).join("/")).filter(Boolean)
  if (!dirs.length) return null
  const common = dirs[0].split("/")[0]
  if (dirs.every((d) => d.startsWith(common + "/") || d === common)) {
    return common
  }
  return null
}
