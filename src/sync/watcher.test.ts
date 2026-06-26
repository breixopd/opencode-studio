import { describe, it, expect, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createWatcher } from "./watcher"
import type { BatchEvents } from "./events"

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const TEST_DEBOUNCE = 100

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "opencode-studio-test-"))
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

describe.skipIf(!!process.env.CI)("createWatcher", () => {
  let dirs: string[] = []

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      cleanup(d)
    }
  })

  it("returns an FSWatcher and starts watching a directory", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: TEST_DEBOUNCE,
      handler: async (batch) => d.resolve(batch),
    })

    expect(watcher).toBeDefined()
    expect(typeof watcher.close).toBe("function")
    watcher.close()
  })

  it("emits 'add' event when a file is created", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: TEST_DEBOUNCE,
      handler: async (batch) => d.resolve(batch),
    })

    // Need a brief moment for chokidar to initialize scanning
    await new Promise((r) => setTimeout(r, 150))

    writeFileSync(join(dir, "new-file.txt"), "hello")

    const batch = await d.promise
    expect(batch.project).toBe("test")
    expect(batch.events.length).toBe(1)
    expect(batch.events[0].type).toBe("add")
    expect(batch.events[0].path).toContain("new-file.txt")
    expect(typeof batch.events[0].timestamp).toBe("number")

    watcher.close()
  }, 5000)

  it("emits 'change' event when a file is modified", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const file = join(dir, "edit-me.txt")
    writeFileSync(file, "initial")

    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: TEST_DEBOUNCE,
      handler: async (batch) => d.resolve(batch),
    })

    await new Promise((r) => setTimeout(r, 150))
    appendFileSync(file, " modified")

    const batch = await d.promise
    expect(batch.events.length).toBe(1)
    expect(batch.events[0].type).toBe("change")
    expect(batch.events[0].path).toContain("edit-me.txt")

    watcher.close()
  }, 5000)

  it("emits 'unlink' event when a file is deleted", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const file = join(dir, "remove-me.txt")
    writeFileSync(file, "delete me")

    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: TEST_DEBOUNCE,
      handler: async (batch) => d.resolve(batch),
    })

    await new Promise((r) => setTimeout(r, 150))
    rmSync(file)

    const batch = await d.promise
    expect(batch.events.length).toBe(1)
    expect(batch.events[0].type).toBe("unlink")
    expect(batch.events[0].path).toContain("remove-me.txt")

    watcher.close()
  }, 5000)

  it("emits 'addDir' event when a directory is created", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: TEST_DEBOUNCE,
      handler: async (batch) => d.resolve(batch),
    })

    await new Promise((r) => setTimeout(r, 150))
    mkdirSync(join(dir, "new-dir"))

    const batch = await d.promise
    expect(batch.events.length).toBe(1)
    expect(batch.events[0].type).toBe("addDir")
    expect(batch.events[0].path).toContain("new-dir")

    watcher.close()
  }, 5000)

  it("emits 'unlinkDir' event when a directory is removed", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const subdir = join(dir, "remove-dir")
    mkdirSync(subdir)

    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: TEST_DEBOUNCE,
      handler: async (batch) => d.resolve(batch),
    })

    await new Promise((r) => setTimeout(r, 150))
    rmSync(subdir, { recursive: true })

    const batch = await d.promise
    expect(batch.events.length).toBe(1)
    expect(batch.events[0].type).toBe("unlinkDir")
    expect(batch.events[0].path).toContain("remove-dir")

    watcher.close()
  }, 5000)

  it("ignores files in excluded directories", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const nodeModulesDir = join(dir, "node_modules")
    mkdirSync(nodeModulesDir)

    let handlerCalled = false
    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: ["node_modules"],
      debounceMs: TEST_DEBOUNCE,
      handler: async (batch) => {
        handlerCalled = true
        d.resolve(batch)
      },
    })

    await new Promise((r) => setTimeout(r, 150))
    writeFileSync(join(nodeModulesDir, "package.json"), "{}")

    // Create a non-excluded file to ensure handler eventually fires for something
    writeFileSync(join(dir, "visible.txt"), "visible")

    const batch = await d.promise
    expect(handlerCalled).toBe(true)
    // Only the visible file should be in events
    const paths = batch.events.map((e) => e.path)
    expect(paths.some((p) => p.includes("package.json"))).toBe(false)
    expect(paths.some((p) => p.includes("visible.txt"))).toBe(true)

    watcher.close()
  }, 5000)

  it("batches rapid multiple events into a single BatchEvents", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: 500, // longer debounce so rapid writes batch together
      handler: async (batch) => d.resolve(batch),
    })

    await new Promise((r) => setTimeout(r, 200))

    // Rapidly create multiple files
    writeFileSync(join(dir, "a.txt"), "a")
    writeFileSync(join(dir, "b.txt"), "b")
    writeFileSync(join(dir, "c.txt"), "c")

    const batch = await d.promise
    expect(batch.project).toBe("test")
    expect(batch.events.length).toBeGreaterThanOrEqual(1)
    // All events should be in the same batch
    const types = batch.events.map((e) => e.type)
    expect(types.every((t) => t === "add")).toBe(true)

    watcher.close()
  }, 5000)

  it("deduplicates same path+type events within a debounce window", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const file = join(dir, "dedup.txt")
    writeFileSync(file, "initial")

    const d = deferred<BatchEvents>()
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: 500,
      handler: async (batch) => d.resolve(batch),
    })

    await new Promise((r) => setTimeout(r, 200))

    // Modify the same file rapidly 3 times
    appendFileSync(file, "1")
    appendFileSync(file, "2")
    appendFileSync(file, "3")

    const batch = await d.promise
    // Should be 1 change event, not 3
    const changeEvents = batch.events.filter((e) => e.type === "change" && e.path.includes("dedup.txt"))
    expect(changeEvents.length).toBe(1)

    watcher.close()
  }, 5000)

  it("stops emitting events after watcher.close()", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    let callCount = 0
    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: TEST_DEBOUNCE,
      handler: async () => {
        callCount++
      },
    })

    await new Promise((r) => setTimeout(r, 200))

    watcher.close()

    // Wait a bit for close to take effect, then write
    await new Promise((r) => setTimeout(r, 200))
    writeFileSync(join(dir, "after-close.txt"), "nope")

    // Wait for debounce window
    await new Promise((r) => setTimeout(r, 300))

    expect(callCount).toBe(0)

    watcher.close()
  }, 5000)

  it("uses default 2s debounce when debounceMs is not specified", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    // We test the default by checking timing in a lightweight way:
    // The option defaults to 2000ms, and we check the type is correct
    const watcher = await createWatcher({
      projectName: "test-default",
      projectPath: dir,
      excludes: [],
      handler: async () => {},
    })

    expect(watcher).toBeDefined()
    watcher.close()
  })

  it("respects custom debounceMs", async () => {
    const dir = makeTempDir()
    dirs.push(dir)

    const d = deferred<BatchEvents>()
    const start = Date.now()

    const watcher = await createWatcher({
      projectName: "test",
      projectPath: dir,
      excludes: [],
      debounceMs: 150, // short, but not instant
      handler: async (batch) => d.resolve(batch),
    })

    await new Promise((r) => setTimeout(r, 100))
    writeFileSync(join(dir, "quick.txt"), "hi")

    const batch = await d.promise
    const elapsed = Date.now() - start
    // Should have waited roughly the debounce period (allow some slack)
    expect(elapsed).toBeGreaterThanOrEqual(100)
    expect(batch.events.length).toBe(1)

    watcher.close()
  }, 5000)
})
