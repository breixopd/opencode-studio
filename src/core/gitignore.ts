import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

export const STUDIO_GITIGNORE_ENTRY = ".studio/"

function gitignorePath(cwd: string): string {
  return join(cwd, ".gitignore")
}

function gitignoreHasStudio(content: string): boolean {
  return content
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === ".studio" || line === ".studio/" || line === ".studio/**")
}

/** Keep `.studio/` out of git unless the user opted in via studio_preferences. */
export function ensureStudioGitignored(cwd: string, allowCommit = false): "added" | "removed" | "unchanged" {
  const path = gitignorePath(cwd)
  if (!existsSync(path)) {
    if (allowCommit) return "unchanged"
    writeFileSync(path, `${STUDIO_GITIGNORE_ENTRY}\n`, "utf-8")
    return "added"
  }

  const content = readFileSync(path, "utf-8")
  const hasEntry = gitignoreHasStudio(content)

  if (allowCommit && hasEntry) {
    const next = content
      .split("\n")
      .filter((line) => {
        const t = line.trim()
        return t !== ".studio" && t !== ".studio/" && t !== ".studio/**"
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\n$/, "")
    writeFileSync(path, next ? `${next}\n` : "", "utf-8")
    return "removed"
  }

  if (!allowCommit && !hasEntry) {
    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n"
    writeFileSync(path, `${content}${suffix}${STUDIO_GITIGNORE_ENTRY}\n`, "utf-8")
    return "added"
  }

  return "unchanged"
}
