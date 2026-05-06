import chokidar, { type FSWatcher } from "chokidar"
import type { SyncEvent, SyncEventType, BatchEvents } from "./events"

const DEFAULT_DEBOUNCE_MS = 2000

export interface WatcherOptions {
  projectName: string
  projectPath: string
  excludes: string[]
  debounceMs?: number
  handler: (batch: BatchEvents) => Promise<void>
}

export function createWatcher(options: WatcherOptions): FSWatcher {
  const {
    projectName,
    projectPath,
    excludes,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    handler,
  } = options

  const watcher = chokidar.watch(projectPath, {
    ignored: (path: string) =>
      excludes.some((ex) => path.split(/[/\\]/).includes(ex)),
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    depth: 99,
    usePolling: !!process.env.CI,
    interval: 100,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  })

  let pending: SyncEvent[] = []
  let timer: Timer | null = null

  function flush(): void {
    if (pending.length === 0) return
    const batch: BatchEvents = {
      project: projectName,
      events: [...pending],
      firstSeen: pending[0].timestamp,
    }
    pending = []
    handler(batch).catch(console.error)
  }

  function enqueue(type: SyncEventType, path: string): void {
    const exists = pending.some((e) => e.type === type && e.path === path)
    if (exists) return

    pending.push({ type, path, timestamp: Date.now() })

    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
  }

  watcher.on("add", (path) => enqueue("add", path as string))
  watcher.on("change", (path) => enqueue("change", path as string))
  watcher.on("unlink", (path) => enqueue("unlink", path as string))
  watcher.on("addDir", (path) => enqueue("addDir", path as string))
  watcher.on("unlinkDir", (path) => enqueue("unlinkDir", path as string))

  watcher.on("error", (err) => {
    console.error(`[studio-watcher:${projectName}] Error:`, (err as Error).message)
  })

  return watcher
}
