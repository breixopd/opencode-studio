import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { clearActiveDirectory, setActiveDirectory } from "./active-dir"
import { closeStudioDb } from "./studio-db"
import { addRule } from "./workspace-base"
import { syncRulesToAgentsMd } from "./agents-md-sync"

describe("agents-md-sync", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-agents-"))
    setActiveDirectory(dir)
    // Need studio dirs + DB initialized
    const { ensureStudioDirs } = require("./studio-dir")
    ensureStudioDirs()
  })

  afterEach(() => {
    closeStudioDb(dir)
    clearActiveDirectory()
    rmSync(dir, { recursive: true, force: true })
  })

  it("creates AGENTS.md with studio rules section", () => {
    addRule("Always run tests before commit")

    const synced = syncRulesToAgentsMd(dir)
    expect(synced).toBe(true)

    const agentsContent = readFileSync(join(dir, "AGENTS.md"), "utf-8")
    expect(agentsContent).toContain("studio-rules-start")
    expect(agentsContent).toContain("Always run tests before commit")
    expect(agentsContent).toContain("studio-rules-end")
  })

  it("preserves existing AGENTS.md content outside the studio section", () => {
    // Write existing AGENTS.md with user content
    const userContent = "# My Project\n\n- Use 2-space indent\n\n<!-- studio-rules-start -->\nOld rules\n<!-- studio-rules-end -->\n\n## More docs\n"
    require("fs").writeFileSync(join(dir, "AGENTS.md"), userContent)

    addRule("Never commit to main")

    syncRulesToAgentsMd(dir)

    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8")
    // User content before the section is preserved
    expect(content).toContain("# My Project")
    expect(content).toContain("Use 2-space indent")
    // Old rules replaced with new
    expect(content).toContain("Never commit to main")
    expect(content).not.toContain("Old rules")
    // User content after the section is preserved
    expect(content).toContain("More docs")
  })

  it("does not write when content unchanged (idempotent)", () => {
    addRule("Don't use any")

    // First sync writes
    syncRulesToAgentsMd(dir)
    // Second sync should be a no-op
    const secondSync = syncRulesToAgentsMd(dir)
    expect(secondSync).toBe(false)
  })
})
