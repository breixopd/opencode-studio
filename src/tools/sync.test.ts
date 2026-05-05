import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import type { WatcherOptions } from "../sync/watcher"
import { EventEmitter } from "events"
import type { FSWatcher } from "chokidar"

function createFakeProcess() {
  const proc = new EventEmitter()
  ;(proc as any).stdout = new EventEmitter()
  ;(proc as any).stderr = new EventEmitter()
  ;(proc as any).stdin = new EventEmitter()
  ;(proc as any).stdin.write = mock(() => true)
  ;(proc as any).stdin.end = mock(() => {})
  ;(proc as any).kill = mock(() => {})
  return proc
}

const sharedProcess = createFakeProcess()
const mockSpawn = mock(() => sharedProcess)

const mockLoadConfig = mock(() => ({
  ssh: { user: "dev", host: "remote.example.com", identityFile: "/tmp/key", port: 22 },
  tunnel: { localPort: 8443, remotePort: 8443, host: "remote.example.com" },
  projects: {
    myapp: { local: "/home/dev/myapp", remote: "/opt/app/myapp", excludes: [".git/", "node_modules/"] },
  },
  defaultExcludes: [".git/", "node_modules/"],
}))

const mockBulkSync = mock(() => Promise.resolve())
const mockSyncFile = mock(() => Promise.resolve())
const mockDeleteRemoteFile = mock(() => Promise.resolve())

const fakeWatcherClose = mock(() => Promise.resolve())
const fakeWatcher: Partial<FSWatcher> & { close: () => Promise<void> } = {
  close: fakeWatcherClose,
  on: mock(() => fakeWatcher as FSWatcher),
}
const mockCreateWatcher = mock(() => fakeWatcher as FSWatcher)

mock.module("child_process", () => ({ spawn: mockSpawn }))
mock.module("../config/config", () => ({
  loadConfig: mockLoadConfig,
  addProject: mock(() => {}),
  removeProject: mock(() => {}),
  listProjects: mock(() => ({})),
}))
mock.module("../sync/watcher", () => ({ createWatcher: mockCreateWatcher }))
mock.module("../sync/transfers", () => ({
  bulkSync: mockBulkSync,
  syncFile: mockSyncFile,
  deleteRemoteFile: mockDeleteRemoteFile,
}))

const { studio_sync_start, studio_sync_stop } = await import("./sync")

const ctx: any = null!

describe("studio_sync_start", () => {
  afterEach(async () => {
    await studio_sync_stop.execute({ project: "myapp" }, ctx)
  })

  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockSpawn.mockClear()
    mockBulkSync.mockClear()
    mockCreateWatcher.mockClear()
    fakeWatcherClose.mockClear()
  })

  it("starts sync for a configured project", async () => {
    const result = await studio_sync_start.execute({ project: "myapp" }, ctx)

    expect(result).toContain("Sync started for 'myapp'")
    expect(result).toContain("remote.example.com:/opt/app/myapp")
    expect(mockLoadConfig).toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalled()
    expect(mockBulkSync).toHaveBeenCalledTimes(1)
    expect(mockCreateWatcher).toHaveBeenCalledTimes(1)

    // @ts-expect-error bun mock call args typing limitation
    const opts = mockCreateWatcher.mock.calls[0]?.[0] as WatcherOptions
    expect(opts.projectName).toBe("myapp")
    expect(opts.projectPath).toBe("/home/dev/myapp")
    expect(opts.excludes).toEqual([".git/", "node_modules/"])
  })

  it("returns error for non-existent project", async () => {
    const result = await studio_sync_start.execute({ project: "ghost" }, ctx)

    expect(result).toContain("Error: Project 'ghost' not found")
    expect(mockBulkSync).not.toHaveBeenCalled()
  })

  it("returns already-running message if sync is active", async () => {
    await studio_sync_start.execute({ project: "myapp" }, ctx)
    mockLoadConfig.mockClear()

    const result = await studio_sync_start.execute({ project: "myapp" }, ctx)

    expect(result).toContain("already running")
    expect(mockBulkSync).toHaveBeenCalledTimes(1)
  })

  it("returns error when bulk sync fails", async () => {
    mockBulkSync.mockRejectedValueOnce(new Error("SSH connection refused"))

    const result = await studio_sync_start.execute({ project: "myapp" }, ctx)

    expect(result).toContain("Error during bulk sync")
    expect(result).toContain("SSH connection refused")
  })
})

describe("studio_sync_stop", () => {
  afterEach(async () => {
    await studio_sync_stop.execute({ project: "myapp" }, ctx)
  })

  beforeEach(() => {
    mockLoadConfig.mockClear()
    mockSpawn.mockClear()
    mockBulkSync.mockClear()
    mockCreateWatcher.mockClear()
    fakeWatcherClose.mockClear()
  })

  it("stops an active sync", async () => {
    await studio_sync_start.execute({ project: "myapp" }, ctx)

    const result = await studio_sync_stop.execute({ project: "myapp" }, ctx)

    expect(result).toContain("Sync stopped for 'myapp'")
    expect(fakeWatcherClose).toHaveBeenCalledTimes(1)
  })

  it("returns not-running for unknown project", async () => {
    const result = await studio_sync_stop.execute({ project: "unknown" }, ctx)

    expect(result).toContain("No sync running for 'unknown'")
  })
})
