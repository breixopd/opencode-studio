import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { existsSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { Client } from "ssh2"
import { setSSHFactory, resetSSHFactory } from "./factory"
import { createSession, execCommand, uploadFile, closeSession } from "./manager"
import type { SSHSession, SSHSessionConfig } from "./types"

function makeMockSession(client: MockClient, config: SSHSessionConfig): SSHSession {
  return {
    client: client as unknown as Client,
    config,
    alive: true,
    controlPath: "ssh2://testuser@testhost.example.com",
  }
}

interface MockStream {
  on: ReturnType<typeof mock>
  stderr: { on: ReturnType<typeof mock> }
}

interface MockSftp {
  fastPut: ReturnType<typeof mock>
}

interface MockClient {
  exec: ReturnType<typeof mock>
  sftp: ReturnType<typeof mock>
  end: ReturnType<typeof mock>
  on: ReturnType<typeof mock>
  connect: ReturnType<typeof mock>
}

function mockStream(opts?: { exitCode?: number; stderrData?: string }): MockStream {
  const exitCode = opts?.exitCode ?? 0
  const stderrData = opts?.stderrData
  return {
    on: mock((event: string, handler: Function) => {
      if (event === "data") handler(Buffer.from("mock output"))
      if (event === "close") setTimeout(() => handler(exitCode), 1)
    }),
    stderr: {
      on: mock((event: string, handler: Function) => {
        if (event === "data" && stderrData) handler(Buffer.from(stderrData))
      }),
    },
  }
}

function mockClient(opts?: {
  execError?: Error
  exitCode?: number
  stderrData?: string
  sftpError?: Error
  fastPutError?: Error
  sftpObj?: MockSftp
}): MockClient {
  const sftpObj: MockSftp = opts?.sftpObj ?? {
    fastPut: mock((local: string, remote: string, cb: Function) => {
      cb(opts?.fastPutError ?? null)
    }),
  }

  return {
    exec: mock((cmd: string, cb: Function) => {
      if (opts?.execError) return cb(opts.execError)
      const stream = mockStream({ exitCode: opts?.exitCode, stderrData: opts?.stderrData })
      cb(null, stream)
    }),
    sftp: mock((cb: Function) => {
      if (opts?.sftpError) return cb(opts.sftpError)
      cb(null, sftpObj)
    }),
    end: mock(() => {}),
    on: mock(() => {}),
    connect: mock(() => {}),
  }
}

const testConfig: SSHSessionConfig = {
  user: "testuser",
  host: "testhost.example.com",
  identityFile: "/home/testuser/.ssh/id_ed25519",
}

describe("SSH Manager (ssh2)", () => {
  let client: MockClient

  beforeEach(() => {
    client = mockClient()
    setSSHFactory({
      connect: mock(async () => makeMockSession(client, testConfig)),
    })
  })

  afterEach(() => {
    resetSSHFactory()
  })

  describe("createSession", () => {
    it("delegates to factory.connect and returns a session", async () => {
      const session = await createSession(testConfig)

      expect(session.config).toEqual(testConfig)
      expect(session.alive).toBe(true)
      expect(session.controlPath).toBe("ssh2://testuser@testhost.example.com")
      expect(session.client as unknown).toBe(client as unknown)
    })
  })

  describe("execCommand", () => {
    it("resolves with stdout on success", async () => {
      const session = await createSession(testConfig)
      const result = await execCommand(session, "echo OK")

      expect(result).toBe("mock output")
      expect(client.exec).toHaveBeenCalledWith("echo OK", expect.any(Function))
    })

    it("rejects on non-zero exit code with stderr", async () => {
      client = mockClient({ exitCode: 1, stderrData: "permission denied" })
      setSSHFactory({
        connect: mock(async () => makeMockSession(client, testConfig)),
      })
      const session = await createSession(testConfig)

      await expect(execCommand(session, "ls /root")).rejects.toThrow("permission denied")
    })

    it("rejects on non-zero exit code without stderr", async () => {
      client = mockClient({ exitCode: 127 })
      setSSHFactory({
        connect: mock(async () => makeMockSession(client, testConfig)),
      })
      const session = await createSession(testConfig)

      await expect(execCommand(session, "crash")).rejects.toThrow("exit 127")
    })

    it("rejects on exec error", async () => {
      client = mockClient({ execError: new Error("connection lost") })
      setSSHFactory({
        connect: mock(async () => makeMockSession(client, testConfig)),
      })
      const session = await createSession(testConfig)

      await expect(execCommand(session, "cmd")).rejects.toThrow("connection lost")
    })
  })

  describe("uploadFile", () => {
    let tmpFile: string

    beforeEach(() => {
      tmpFile = join(tmpdir(), `ssh-test-${Date.now()}-${Math.random()}`)
    })

    afterEach(() => {
      if (existsSync(tmpFile)) unlinkSync(tmpFile)
    })

    it("rejects when local file does not exist", async () => {
      const session = await createSession(testConfig)

      await expect(uploadFile(session, "/nonexistent/path", "/remote/path")).rejects.toThrow(
        "File not found: /nonexistent/path",
      )
    })

    it("uploads via sftp.fastPut with atomic rename", async () => {
      const sftpObj: MockSftp = {
        fastPut: mock((local: string, remote: string, cb: Function) => cb(null)),
      }
      client = mockClient({ sftpObj })
      setSSHFactory({
        connect: mock(async () => makeMockSession(client, testConfig)),
      })
      writeFileSync(tmpFile, "hello world")
      const session = await createSession(testConfig)

      await uploadFile(session, tmpFile, "/remote/file.txt")

      expect(client.sftp).toHaveBeenCalled()
      expect(sftpObj.fastPut).toHaveBeenCalledWith(tmpFile, "/remote/file.txt.tmp", expect.any(Function))
      expect(client.exec).toHaveBeenCalledWith(
        "mv /remote/file.txt.tmp /remote/file.txt",
        expect.any(Function),
      )
    })

    it("rejects on sftp error", async () => {
      client = mockClient({ sftpError: new Error("sftp failed") })
      setSSHFactory({
        connect: mock(async () => makeMockSession(client, testConfig)),
      })
      writeFileSync(tmpFile, "data")
      const session = await createSession(testConfig)

      await expect(uploadFile(session, tmpFile, "/remote/file.txt")).rejects.toThrow("sftp failed")
    })

    it("rejects on fastPut error", async () => {
      client = mockClient({ fastPutError: new Error("disk full") })
      setSSHFactory({
        connect: mock(async () => makeMockSession(client, testConfig)),
      })
      writeFileSync(tmpFile, "data")
      const session = await createSession(testConfig)

      await expect(uploadFile(session, tmpFile, "/remote/file.txt")).rejects.toThrow("disk full")
    })
  })

  describe("closeSession", () => {
    it("sets alive to false and calls client.end()", async () => {
      const session = await createSession(testConfig)

      expect(session.alive).toBe(true)

      await closeSession(session)

      expect(session.alive).toBe(false)
      expect(client.end).toHaveBeenCalled()
    })

    it("is safe to call multiple times", async () => {
      const session = await createSession(testConfig)

      await closeSession(session)
      await closeSession(session)

      expect(client.end).toHaveBeenCalledTimes(2)
    })
  })
})
