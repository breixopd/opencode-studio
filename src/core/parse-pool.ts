/**
 * OS-thread pool for tree-sitter WASM parsing via `worker_threads`.
 *
 * The previous index "concurrency" was a promise pool on the main thread —
 * WASM `parse()` is CPU-bound and shared one Parser (racey). This pool gives
 * each worker its own Parser so multi-core indexing is real.
 *
 * Disable with STUDIO_PARSE_WORKERS=0 (falls back to serialized main-thread parse).
 */
import { existsSync } from "fs"
import { cpus } from "os"
import { fileURLToPath } from "url"
import { Worker } from "worker_threads"
import * as log from "./logger"
import {
  analyzeWithTreeSitter,
  type AstFileAnalysis,
} from "./tree-sitter-parser"
import type { ParseWorkerRequest, ParseWorkerResponse } from "./parse-worker"

type Job = {
  id: number
  content: string
  file: string
  resolve: (v: AstFileAnalysis | null) => void
  reject: (e: Error) => void
}

type WorkerSlot = {
  worker: Worker
  busy: boolean
  jobId: number | null
}

export type ParsePoolMode = "workers" | "inline"

function resolveWorkerScript(): string {
  // Bundled plugin: dist/index.js → dist/parse-worker.js
  // Source tests: src/core/parse-pool.ts → src/core/parse-worker.ts
  const candidates = [
    fileURLToPath(new URL("./parse-worker.js", import.meta.url)),
    fileURLToPath(new URL("./parse-worker.ts", import.meta.url)),
    fileURLToPath(new URL("./core/parse-worker.js", import.meta.url)),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  throw new Error(`parse-worker not found next to ${import.meta.url}`)
}

export function defaultParseWorkerCount(): number {
  const env = process.env.STUDIO_PARSE_WORKERS?.trim()
  if (env === "0") return 0
  if (env && /^\d+$/.test(env)) return Math.max(0, Number(env))
  return Math.min(8, Math.max(1, cpus().length || 1))
}

export class ParsePool {
  readonly mode: ParsePoolMode
  private readonly slots: WorkerSlot[] = []
  private readonly queue: Job[] = []
  private readonly inflight = new Map<number, Job>()
  private nextId = 1
  private closed = false

  private constructor(mode: ParsePoolMode) {
    this.mode = mode
  }

  /** Number of live OS worker threads (0 when inline). */
  get workerCount(): number {
    return this.slots.length
  }

  static async create(size = defaultParseWorkerCount()): Promise<ParsePool> {
    const n = Math.max(0, Math.floor(size))
    if (n === 0) return new ParsePool("inline")

    const pool = new ParsePool("workers")
    try {
      const script = resolveWorkerScript()
      for (let i = 0; i < n; i++) {
        const worker = new Worker(script)
        const slot: WorkerSlot = { worker, busy: false, jobId: null }
        worker.on("message", (msg: ParseWorkerResponse) => pool.onWorkerMessage(slot, msg))
        worker.on("error", (err) => {
          log.debugCatch("src/core/parse-pool.ts:worker.error", err)
          pool.failSlot(slot, err instanceof Error ? err : new Error(String(err)))
        })
        worker.on("exit", (code) => {
          if (!pool.closed && code !== 0) {
            log.debugCatch(
              "src/core/parse-pool.ts:worker.exit",
              new Error(`worker exited ${code}`),
            )
          }
        })
        pool.slots.push(slot)
      }
      // Warm one worker so first-index latency isn't all WASM init.
      await pool.analyze("def _studio_warm():\n    pass\n", "warm.py")
      return pool
    } catch (err) {
      log.debugCatch("src/core/parse-pool.ts:create", err)
      await pool.close()
      return new ParsePool("inline")
    }
  }

  async analyze(content: string, file: string): Promise<AstFileAnalysis | null> {
    if (this.closed) throw new Error("ParsePool is closed")
    if (this.mode === "inline" || this.slots.length === 0) {
      return analyzeWithTreeSitter(content, file)
    }

    return new Promise<AstFileAnalysis | null>((resolve, reject) => {
      const job: Job = {
        id: this.nextId++,
        content,
        file,
        resolve,
        reject,
      }
      this.queue.push(job)
      this.pump()
    })
  }

  async close(): Promise<void> {
    this.closed = true
    const pending = this.queue.splice(0)
    for (const job of pending) {
      job.reject(new Error("ParsePool closed"))
    }
    for (const job of this.inflight.values()) {
      job.reject(new Error("ParsePool closed"))
    }
    this.inflight.clear()
    await Promise.all(
      this.slots.map(async (slot) => {
        try {
          await slot.worker.terminate()
        } catch (err) {
          log.debugCatch("src/core/parse-pool.ts:close", err)
        }
      }),
    )
    this.slots.length = 0
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy) continue
      const job = this.queue.shift()
      if (!job) return
      slot.busy = true
      slot.jobId = job.id
      this.inflight.set(job.id, job)
      const req: ParseWorkerRequest = {
        id: job.id,
        content: job.content,
        file: job.file,
      }
      slot.worker.postMessage(req)
    }
  }

  private onWorkerMessage(slot: WorkerSlot, msg: ParseWorkerResponse): void {
    const job = this.inflight.get(msg.id)
    slot.busy = false
    slot.jobId = null
    if (job) this.inflight.delete(msg.id)
    if (!job) {
      this.pump()
      return
    }
    if (msg.ok) job.resolve(msg.result)
    else job.reject(new Error(msg.error))
    this.pump()
  }

  private failSlot(slot: WorkerSlot, err: Error): void {
    const id = slot.jobId
    slot.busy = false
    slot.jobId = null
    if (id != null) {
      const job = this.inflight.get(id)
      this.inflight.delete(id)
      if (job) job.reject(err)
    }
    this.pump()
  }
}
