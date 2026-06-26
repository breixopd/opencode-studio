import { describe, it, expect, afterEach, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { execSync } from "child_process"
import {
  branchScopeKey,
  branchSwitchNotice,
  currentBranch,
  detectBranchSwitch,
} from "./branch-context"
import { closeStudioDb, openStudioDb } from "./studio-db"

describe("branch-context", () => {
  let root: string

  afterEach(() => {
    if (root) {
      closeStudioDb(root)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("returns 'detached' outside a git repo", () => {
    root = mkdtempSync(join(tmpdir(), "studio-branch-"))
    expect(currentBranch(root)).toBe("detached")
    expect(branchScopeKey(root)).toBe(`${root}:detached`)
  })

  describe("in a git repo", () => {
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "studio-branch-"))
      execSync("git init -b main", { cwd: root, stdio: "ignore" })
      execSync("git config user.email t@t.tt", { cwd: root, stdio: "ignore" })
      execSync("git config user.name t", { cwd: root, stdio: "ignore" })
      mkdirSync(join(root, "src"))
      execSync("git add .", { cwd: root, stdio: "ignore" })
      execSync("git commit -m init --allow-empty", { cwd: root, stdio: "ignore" })
    })

    it("detects current branch", () => {
      expect(currentBranch(root)).toBe("main")
    })

    it("detects switch to new branch", () => {
      // First call records 'main' as previous
      openStudioDb(root)
      expect(detectBranchSwitch(root)).toBe(null) // initial record
      execSync("git checkout -b feature", { cwd: root, stdio: "ignore" })
      expect(detectBranchSwitch(root)).toBe("main")
      // After recording, no further switch
      expect(detectBranchSwitch(root)).toBe(null)
    })

    it("emits notice on switch", () => {
      openStudioDb(root)
      detectBranchSwitch(root) // record 'main'
      execSync("git checkout -b feat-x", { cwd: root, stdio: "ignore" })
      const notice = branchSwitchNotice(root)
      expect(notice).toContain("main → feat-x")
      // Second call is silent
      expect(branchSwitchNotice(root)).toBe(null)
    })

    it("stays silent on same branch", () => {
      openStudioDb(root)
      detectBranchSwitch(root)
      expect(branchSwitchNotice(root)).toBe(null)
    })
  })
})
