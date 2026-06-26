/**
 * Per-session output deduplication.
 *
 * Replaces the old process-global OutputDeduplicator singleton which suppressed
 * legitimate identical results across sessions and grew unbounded.
 *
 * Each session gets its own deduper (keyed by sessionID), auto-created on first
 * use and cleaned up after a TTL to prevent memory leaks on long-running
 * processes with many sessions.
 */
import { OutputDeduplicator } from "./token-budget"

const dedupers = new Map<string, { deduper: OutputDeduplicator; lastAccess: number }>()
const TTL_MS = 30 * 60 * 1000 // 30 minutes since last access

/** Get (or create) the deduplicator for a session. */
export function getSessionDeduper(sessionID?: string): OutputDeduplicator {
  const key = sessionID ?? "_default"
  const entry = dedupers.get(key)
  if (entry) {
    entry.lastAccess = Date.now()
    return entry.deduper
  }
  const deduper = new OutputDeduplicator()
  dedupers.set(key, { deduper, lastAccess: Date.now() })
  return deduper
}

/** Remove a session's deduper (call on session end). */
export function clearSessionDeduper(sessionID: string): void {
  dedupers.delete(sessionID)
}

/** Evict stale dedupers that haven't been accessed in TTL_MS. */
export function evictStaleDedupers(): void {
  const now = Date.now()
  for (const [key, entry] of dedupers) {
    if (now - entry.lastAccess > TTL_MS) {
      dedupers.delete(key)
    }
  }
}

// Run eviction every 5 minutes to prevent leaks.
setInterval(evictStaleDedupers, 5 * 60 * 1000).unref?.()
