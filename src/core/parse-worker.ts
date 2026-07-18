/**
 * Worker-thread entry for tree-sitter WASM parsing.
 * Each worker owns its own Parser + language cache (no main-thread races).
 */
import { parentPort } from "worker_threads"
import { analyzeWithTreeSitter } from "./tree-sitter-parser"

export type ParseWorkerRequest = {
  id: number
  content: string
  file: string
}

export type ParseWorkerResponse =
  | { id: number; ok: true; result: Awaited<ReturnType<typeof analyzeWithTreeSitter>> }
  | { id: number; ok: false; error: string }

if (!parentPort) {
  throw new Error("parse-worker must run as a worker_threads Worker")
}

parentPort.on("message", async (msg: ParseWorkerRequest) => {
  try {
    const result = await analyzeWithTreeSitter(msg.content, msg.file)
    const res: ParseWorkerResponse = { id: msg.id, ok: true, result }
    parentPort!.postMessage(res)
  } catch (err) {
    const res: ParseWorkerResponse = {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    parentPort!.postMessage(res)
  }
})
