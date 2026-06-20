import { mock, describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import { bulkSync, syncFile, deleteRemoteFile } from "./transfers"
import type { SSHSession } from "../ssh/types"
import type { Client } from "ssh2"

function mockStream(exitCode = 0): any {
  return {
    on: mock((event: string, handler: Function) => {
      if (event === "close") handler(exitCode)
    }),
    stderr: { on: mock(() => {}) },
  }
}

interface TestCtx {
  session: SSHSession
  client: any
  sftp: any
  fastPutCalls: Array<{ local: string; remote: string }>
  execCalls: Array<string>
}

function createCtx(): TestCtx {
  const fastPutCalls: Array<{ local: string; remote: string }> = []
  const execCalls: Array<string> = []

  const sftp = {
    fastPut: mock(
      (local: string, remote: string, cb: (err?: Error | null) => void) => {
        fastPutCalls.push({ local, remote })
        cb(null)
      },
    ),
  }

  const client: any = {
    exec: mock((cmd: string, cb: (err: Error | null, s: any) => void) => {
      execCalls.push(cmd)
      cb(null, mockStream())
    }),
    sftp: mock((cb: (err: Error | null, s?: any) => void) => {
      cb(null, sftp)
    }),
  }

  const session: SSHSession = {
    config: {
      user: "testuser",
      host: "testhost.example.com",
      identityFile: "/home/testuser/.ssh/id_ed25519",
    },
    client: client as unknown as Client,
    controlPath: "ssh2://testuser@testhost.example.com",
    alive: true,
  }

  return { session, client, sftp, fastPutCalls, execCalls }
}

describe.skipIf(!!process.env.GITHUB_ACTIONS)("transfers (ssh2 SFTP)", () => {
  let tmpDir: string
  let ctx: TestCtx

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "transfers-test-"))
    ctx = createCtx()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("bulkSync", () => {
    test("uploads files with atomic rename per file", async () => {
      writeFileSync(join(tmpDir, "a.txt"), "aaa")
      writeFileSync(join(tmpDir, "b.txt"), "bbb")

      await bulkSync(ctx.session, tmpDir, "/remote/proj", [])

      expect(ctx.fastPutCalls).toEqual([
        { local: join(tmpDir, "a.txt"), remote: "/remote/proj/a.txt.tmp" },
        { local: join(tmpDir, "b.txt"), remote: "/remote/proj/b.txt.tmp" },
      ])

      const mvCalls = ctx.execCalls.filter((c) => c.startsWith("mv"))
      expect(mvCalls).toEqual([
        "mv '/remote/proj/a.txt.tmp' '/remote/proj/a.txt'",
        "mv '/remote/proj/b.txt.tmp' '/remote/proj/b.txt'",
      ])
    })

    test("creates remote root directory", async () => {
      writeFileSync(join(tmpDir, "f.txt"), "data")
      await bulkSync(ctx.session, tmpDir, "/remote/proj", [])
      expect(ctx.execCalls).toContain("mkdir -p '/remote/proj'")
    })

    test("creates subdirectories for nested files", async () => {
      mkdirSync(join(tmpDir, "sub"), { recursive: true })
      writeFileSync(join(tmpDir, "sub", "nested.txt"), "nested")
      await bulkSync(ctx.session, tmpDir, "/remote/proj", [])
      expect(ctx.execCalls).toContain("mkdir -p '/remote/proj/sub'")
    })

    test("skips excluded directories", async () => {
      mkdirSync(join(tmpDir, "node_modules"), { recursive: true })
      writeFileSync(join(tmpDir, "node_modules", "pkg.js"), "pkg")
      writeFileSync(join(tmpDir, "src.js"), "src")

      await bulkSync(ctx.session, tmpDir, "/remote/proj", ["node_modules"])

      expect(ctx.fastPutCalls.length).toBe(1)
      expect(ctx.fastPutCalls[0].local).toBe(join(tmpDir, "src.js"))
    })

    test("resolves immediately when directory is empty", async () => {
      await expect(
        bulkSync(ctx.session, tmpDir, "/remote/proj", []),
      ).resolves.toBeUndefined()
      expect(ctx.fastPutCalls.length).toBe(0)
    })

    test("rejects when a file fails to upload", async () => {
      writeFileSync(join(tmpDir, "f.txt"), "data")
      ctx.sftp.fastPut = mock(
        (_local: string, _remote: string, cb: Function) => {
          cb(new Error("disk full"))
        },
      )
      await expect(
        bulkSync(ctx.session, tmpDir, "/remote/proj", []),
      ).rejects.toThrow(/failed to sync/)
    })

    test("rejects when SFTP connection fails", async () => {
      writeFileSync(join(tmpDir, "f.txt"), "data")
      ctx.client.sftp = mock((cb: Function) => cb(new Error("sftp failed")))
      await expect(
        bulkSync(ctx.session, tmpDir, "/remote/proj", []),
      ).rejects.toThrow("sftp failed")
    })
  })

  describe("syncFile", () => {
    test("uploads single file via SFTP with atomic rename", async () => {
      const localFile = join(tmpDir, "test.txt")
      writeFileSync(localFile, "content")

      await syncFile(ctx.session, localFile, "/remote/path/file.txt")

      expect(ctx.fastPutCalls).toEqual([
        { local: localFile, remote: "/remote/path/file.txt.tmp" },
      ])
      expect(ctx.execCalls).toContain(
        "mv '/remote/path/file.txt.tmp' '/remote/path/file.txt'",
      )
    })

    test("creates remote directory before uploading", async () => {
      const localFile = join(tmpDir, "test.txt")
      writeFileSync(localFile, "data")
      await syncFile(ctx.session, localFile, "/remote/dir/file.txt")
      expect(ctx.execCalls).toContain("mkdir -p '/remote/dir'")
    })

    test("throws when local file does not exist", async () => {
      await expect(
        syncFile(ctx.session, "/nonexistent/path.txt", "/remote/path.txt"),
      ).rejects.toThrow("File not found: /nonexistent/path.txt")
    })

    test("rejects on SFTP error", async () => {
      writeFileSync(join(tmpDir, "f.txt"), "data")
      ctx.client.sftp = mock((cb: Function) => cb(new Error("sftp failed")))
      await expect(
        syncFile(ctx.session, join(tmpDir, "f.txt"), "/remote/f.txt"),
      ).rejects.toThrow("sftp failed")
    })

    test("rejects on fastPut error", async () => {
      writeFileSync(join(tmpDir, "f.txt"), "data")
      ctx.sftp.fastPut = mock(
        (_local: string, _remote: string, cb: Function) => {
          cb(new Error("disk full"))
        },
      )
      await expect(
        syncFile(ctx.session, join(tmpDir, "f.txt"), "/remote/f.txt"),
      ).rejects.toThrow("disk full")
    })
  })

  describe("deleteRemoteFile", () => {
    test("runs rm -f on remote file", async () => {
      await deleteRemoteFile(ctx.session, "/remote/file.txt")
      expect(ctx.execCalls).toContain("rm -f '/remote/file.txt'")
    })

    test("runs rm -rf on remote directory", async () => {
      await deleteRemoteFile(ctx.session, "/remote/dir", true)
      expect(ctx.execCalls).toContain("rm -rf '/remote/dir'")
    })

    test("resolves on success", async () => {
      await expect(
        deleteRemoteFile(ctx.session, "/remote/file.txt"),
      ).resolves.toBeUndefined()
    })

    test("rejects on exec failure", async () => {
      ctx.client.exec = mock((_cmd: string, cb: Function) => {
        cb(new Error("permission denied"))
      })
      await expect(
        deleteRemoteFile(ctx.session, "/remote/file.txt"),
      ).rejects.toThrow("permission denied")
    })
  })
})
