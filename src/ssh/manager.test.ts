import { mock, describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EventEmitter } from "events"
import { writeFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// mock.module must precede imports; a single process is shared so that
// createSession, execCommand, uploadFile, and closeSession all interact
// with the same EventEmitter.
let sharedProcess: any

function createFakeProcess() {
  const proc: any = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = new EventEmitter()
  proc.stdin.write = mock(() => true)
  proc.stdin.end = mock(() => {})
  proc.kill = mock(() => {})
  proc.pid = 99999
  return proc
}

const mockSpawn = mock<(cmd: string, args: readonly string[], opts?: object) => any>(() => sharedProcess)

mock.module("child_process", () => ({
  spawn: mockSpawn,
  ChildProcess: class {},
}))

import { createSession, execCommand, uploadFile, closeSession } from "./manager"
import type { SSHSessionConfig } from "./types"

const defaultConfig: SSHSessionConfig = {
  user: "testuser",
  host: "testhost.example.com",
  identityFile: "/home/testuser/.ssh/id_ed25519",
}

describe("SSH Manager", () => {
  let tmpFile: string

  beforeEach(() => {
    sharedProcess = createFakeProcess()
    mockSpawn.mockClear()
    tmpFile = join(tmpdir(), `ssh-test-${Date.now()}`)
  })

  afterEach(() => {
    if (existsSync(tmpFile)) unlinkSync(tmpFile)
  })

  describe("createSession", () => {
    test("builds correct SSH args with ControlMaster", () => {
      const session = createSession(defaultConfig)

      expect(session.alive).toBe(true)
      expect(session.config).toEqual(defaultConfig)
      expect(session.controlPath).toContain("studio-ssh-testuser@testhost.example.com")

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const call = mockSpawn.mock.calls[0] as [string, readonly string[], { stdio: string[] }]
      expect(call[0]).toBe("ssh")
      expect(call[1]).toContain("-o")
      expect(call[1]).toContain("ControlMaster=auto")
      expect(call[1]).toContain("-i")
      expect(call[1]).toContain(defaultConfig.identityFile)
      expect(call[1]).toContain("testuser@testhost.example.com")
      expect(call[1]).toContain("-N")
      expect(call[2]?.stdio).toEqual(["pipe", "pipe", "pipe"])
    })
  })

  describe("execCommand", () => {
    test("resolves with stdout on success", async () => {
      const session = createSession(defaultConfig)

      const promise = execCommand(session, "ls -la")
      sharedProcess.stdout.emit("data", Buffer.from("file1\nfile2\n"))
      sharedProcess.emit("close", 0)

      await expect(promise).resolves.toBe("file1\nfile2")
    })

    test("rejects on non-zero exit code", async () => {
      const session = createSession(defaultConfig)

      const promise = execCommand(session, "ls /nonexistent")
      sharedProcess.stderr.emit("data", Buffer.from("No such file"))
      sharedProcess.emit("close", 1)

      await expect(promise).rejects.toThrow("No such file")
    })

    test("rejects on non-zero exit without stderr", async () => {
      const session = createSession(defaultConfig)

      const promise = execCommand(session, "crash")
      sharedProcess.emit("close", 127)

      await expect(promise).rejects.toThrow("exit 127")
    })
  })

  describe("uploadFile", () => {
    test("rejects when local file does not exist", async () => {
      const session = createSession(defaultConfig)

      await expect(uploadFile(session, "/nonexistent/path", "/remote/path")).rejects.toThrow(
        "File not found: /nonexistent/path",
      )
    })

    test("pipes file content to stdin and resolves on success", async () => {
      writeFileSync(tmpFile, "hello world")
      const session = createSession(defaultConfig)

      const promise = uploadFile(session, tmpFile, "/remote/file.txt")
      await new Promise((r) => setTimeout(r, 10))
      sharedProcess.emit("close", 0)

      await expect(promise).resolves.toBeUndefined()
      expect(sharedProcess.stdin.write).toHaveBeenCalled()
    })

    test("rejects on remote failure", async () => {
      writeFileSync(tmpFile, "data")
      const session = createSession(defaultConfig)

      const promise = uploadFile(session, tmpFile, "/remote/file.txt")
      await new Promise((r) => setTimeout(r, 10))
      sharedProcess.stderr.emit("data", Buffer.from("disk full"))
      sharedProcess.emit("close", 1)

      await expect(promise).rejects.toThrow("disk full")
    })
  })

  describe("closeSession", () => {
    test("sends SIGTERM then SIGKILL after timeout", async () => {
      const session = createSession(defaultConfig)

      const promise = closeSession(session)
      expect(session.alive).toBe(false)
      expect(sharedProcess.kill).toHaveBeenCalledWith("SIGTERM")

      await promise
      expect(sharedProcess.kill).toHaveBeenCalledWith("SIGKILL")
    }, 5000)

    test("does not throw if process already dead", async () => {
      sharedProcess.kill = mock(() => { throw new Error("ESRCH") })
      const session = createSession(defaultConfig)

      await expect(closeSession(session)).resolves.toBeUndefined()
    })
  })
})
