import { mock, describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EventEmitter } from "events"
import { mkdtempSync, writeFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

let procQueue: any[] = []

function createFakeProcess() {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter() as any
  proc.stdout.pipe = mock(() => proc.stdout)
  proc.stderr = new EventEmitter() as any
  proc.stdin = new EventEmitter() as any
  proc.stdin.write = mock(() => true)
  proc.stdin.end = mock(() => {})
  proc.kill = mock(() => {})
  proc.pid = 99999
  return proc
}

const mockSpawn = mock((..._args: any[]) => {
  return procQueue.shift() ?? createFakeProcess()
})

mock.module("child_process", () => ({
  spawn: mockSpawn,
  ChildProcess: class {},
}))

import { bulkSync, syncFile, deleteRemoteFile } from "./transfers"
import type { SSHSession } from "../ssh/types"

function makeSession(): SSHSession {
  return {
    config: {
      user: "testuser",
      host: "testhost.example.com",
      identityFile: "/home/testuser/.ssh/id_ed25519",
    },
    process: createFakeProcess(),
    controlPath: "/tmp/studio-ssh-testuser@testhost.example.com",
    alive: true,
  }
}

describe("transfers", () => {
  let tmpDir: string
  let tmpFile: string

  beforeEach(() => {
    mockSpawn.mockClear()
    procQueue = []
    tmpDir = mkdtempSync(join(tmpdir(), "transfers-test-"))
    tmpFile = join(tmpDir, "testfile.txt")
  })

  afterEach(() => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile)
    if (existsSync(tmpDir)) {
      try { unlinkSync(tmpDir) } catch { /* ok */ }
    }
  })

  describe("bulkSync", () => {
    test("builds correct tar exclude args", async () => {
      const mkdirFake = createFakeProcess()
      const tarFake = createFakeProcess()
      const sshFake = createFakeProcess()
      procQueue = [mkdirFake, tarFake, sshFake]

      const session = makeSession()
      const promise = bulkSync(session, "/local/project", "/remote/project", [
        "node_modules",
        ".git",
      ])

      mkdirFake.emit("close", 0)
      await new Promise((r) => setImmediate(r))

      expect(mockSpawn.mock.calls[0][0]).toBe("ssh")
      expect(mockSpawn.mock.calls[0][1]).toContain("mkdir -p /remote/project")

      expect(mockSpawn.mock.calls[1][0]).toBe("tar")
      const tarArgs = mockSpawn.mock.calls[1][1] as string[]
      expect(tarArgs).toContain("--exclude")
      expect(tarArgs).toContain("node_modules")
      expect(tarArgs).toContain(".git")
      expect(tarArgs).toContain("-C")
      expect(tarArgs).toContain("/local/project")

      expect(mockSpawn.mock.calls[2][0]).toBe("ssh")
      expect(mockSpawn.mock.calls[2][1]).toContain("tar xf - -C /remote/project")

      sshFake.emit("close", 0)
      await expect(promise).resolves.toBeUndefined()
    })

    test("pipes tar stdout to ssh stdin", async () => {
      const mkdirFake = createFakeProcess()
      const tarFake = createFakeProcess()
      const sshFake = createFakeProcess()
      procQueue = [mkdirFake, tarFake, sshFake]

      const session = makeSession()
      const promise = bulkSync(session, "/local", "/remote", [])

      mkdirFake.emit("close", 0)
      await new Promise((r) => setImmediate(r))

      expect(tarFake.stdout.pipe).toHaveBeenCalledWith(sshFake.stdin)

      sshFake.emit("close", 0)
      await expect(promise).resolves.toBeUndefined()
    })

    test("rejects when mkdir fails", async () => {
      const mkdirFake = createFakeProcess()
      procQueue = [mkdirFake]

      const session = makeSession()
      const promise = bulkSync(session, "/local", "/remote", [])

      mkdirFake.emit("close", 1)

      await expect(promise).rejects.toThrow(
        "Failed to create remote directory: /remote",
      )
    })

    test("rejects when tar transfer fails", async () => {
      const mkdirFake = createFakeProcess()
      const tarFake = createFakeProcess()
      const sshFake = createFakeProcess()
      procQueue = [mkdirFake, tarFake, sshFake]

      const session = makeSession()
      const promise = bulkSync(session, "/local", "/remote", [])

      mkdirFake.emit("close", 0)
      await new Promise((r) => setImmediate(r))

      sshFake.stderr.emit("data", Buffer.from("disk full"))
      sshFake.emit("close", 1)

      await expect(promise).rejects.toThrow("disk full")
    })

    test("rejects tar transfer with fallback exit code when stderr is empty", async () => {
      const mkdirFake = createFakeProcess()
      const tarFake = createFakeProcess()
      const sshFake = createFakeProcess()
      procQueue = [mkdirFake, tarFake, sshFake]

      const session = makeSession()
      const promise = bulkSync(session, "/local", "/remote", [])

      mkdirFake.emit("close", 0)
      await new Promise((r) => setImmediate(r))

      sshFake.emit("close", 2)

      await expect(promise).rejects.toThrow("exit 2")
    })
  })

  describe("syncFile", () => {
    test("uses atomic write pattern (cat > .tmp && mv)", async () => {
      writeFileSync(tmpFile, "file content")
      const sshFake = createFakeProcess()
      procQueue = [sshFake]

      const session = makeSession()
      const promise = syncFile(session, tmpFile, "/remote/path/file.txt")

      await new Promise((r) => setTimeout(r, 10))
      sshFake.emit("close", 0)

      const sshCommand = mockSpawn.mock.calls[0][1].find(
        (arg: string) =>
          typeof arg === "string" &&
          arg.includes("cat >") &&
          arg.includes(".tmp") &&
          arg.includes("mv"),
      )
      expect(sshCommand).toBeDefined()
      expect(sshCommand).toContain("cat > /remote/path/file.txt.tmp")
      expect(sshCommand).toContain("mv /remote/path/file.txt.tmp /remote/path/file.txt")

      await expect(promise).resolves.toBeUndefined()
    })

    test("creates remote directory before writing", async () => {
      writeFileSync(tmpFile, "file content")
      const sshFake = createFakeProcess()
      procQueue = [sshFake]

      const session = makeSession()
      const promise = syncFile(session, tmpFile, "/remote/path/file.txt")

      await new Promise((r) => setTimeout(r, 10))
      sshFake.emit("close", 0)

      const sshCommand = mockSpawn.mock.calls[0][1].find(
        (arg: string) =>
          typeof arg === "string" && arg.includes("mkdir -p"),
      )
      expect(sshCommand).toBeDefined()

      await expect(promise).resolves.toBeUndefined()
    })

    test("pipes file content to ssh stdin", async () => {
      writeFileSync(tmpFile, "file content")
      const sshFake = createFakeProcess()
      procQueue = [sshFake]

      const session = makeSession()
      const promise = syncFile(session, tmpFile, "/remote/file.txt")

      await new Promise((r) => setTimeout(r, 10))
      sshFake.emit("close", 0)

      expect(sshFake.stdin.write).toHaveBeenCalled()
      await expect(promise).resolves.toBeUndefined()
    })

    test("rejects on remote failure", async () => {
      writeFileSync(tmpFile, "data")
      const sshFake = createFakeProcess()
      procQueue = [sshFake]

      const session = makeSession()
      const promise = syncFile(session, tmpFile, "/remote/file.txt")

      await new Promise((r) => setTimeout(r, 10))
      sshFake.stderr.emit("data", Buffer.from("permission denied"))
      sshFake.emit("close", 1)

      await expect(promise).rejects.toThrow("permission denied")
    })
  })

  describe("deleteRemoteFile", () => {
    test("runs rm -f on remote", async () => {
      const sshFake = createFakeProcess()
      procQueue = [sshFake]

      const session = makeSession()
      const promise = deleteRemoteFile(session, "/remote/file.txt")

      sshFake.emit("close", 0)

      expect(mockSpawn.mock.calls[0][0]).toBe("ssh")
      const sshArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(sshArgs.some((a) => a.includes("rm -f /remote/file.txt"))).toBe(
        true,
      )

      await expect(promise).resolves.toBeUndefined()
    })

    test("resolves on success", async () => {
      const sshFake = createFakeProcess()
      procQueue = [sshFake]

      const session = makeSession()
      const promise = deleteRemoteFile(session, "/remote/file.txt")

      sshFake.emit("close", 0)

      await expect(promise).resolves.toBeUndefined()
    })

    test("rejects on remote failure", async () => {
      const sshFake = createFakeProcess()
      procQueue = [sshFake]

      const session = makeSession()
      const promise = deleteRemoteFile(session, "/remote/file.txt")

      sshFake.stderr.emit("data", Buffer.from("no such file"))
      sshFake.emit("close", 1)

      await expect(promise).rejects.toThrow("no such file")
    })

    test("rejects with exit code fallback when stderr is empty", async () => {
      const sshFake = createFakeProcess()
      procQueue = [sshFake]

      const session = makeSession()
      const promise = deleteRemoteFile(session, "/remote/file.txt")

      sshFake.emit("close", 127)

      await expect(promise).rejects.toThrow("exit 127")
    })
  })
})
