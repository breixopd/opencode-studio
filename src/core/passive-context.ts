/**
 * Passive Context — auto-tracks file opens/edits and builds a dynamic
 * "working set" that's injected into the session context.
 *
 * Instead of requiring the user to explicitly pin files, the system
 * passively observes which files are being worked on and surfaces them
 * automatically. Weighted by recency: files edited in the last 10 minutes
 * are high-priority, files from an hour ago are lower.
 *
 * This is the Windsurf "Cascade" pattern — the agent silently knows what
 * you've been working on.
 */

const MAX_TRACKED_FILES = 50
const WORKING_SET_WINDOW_MS = 30 * 60 * 1000 // 30 min window for "active" files

interface FileActivity {
  path: string
  lastEdited: number
  editCount: number
}

const fileActivity = new Map<string, FileActivity>()

/** Record that a file was edited (called from the file.edited event hook). */
export function trackFileEdit(path: string): void {
  const existing = fileActivity.get(path)
  if (existing) {
    existing.lastEdited = Date.now()
    existing.editCount++
  } else {
    // Evict oldest if at capacity
    if (fileActivity.size >= MAX_TRACKED_FILES) {
      let oldestKey = ""
      let oldestTime = Infinity
      for (const [key, val] of fileActivity) {
        if (val.lastEdited < oldestTime) {
          oldestTime = val.lastEdited
          oldestKey = key
        }
      }
      if (oldestKey) fileActivity.delete(oldestKey)
    }
    fileActivity.set(path, { path, lastEdited: Date.now(), editCount: 1 })
  }
}

/** Get the current working set — files sorted by recency, weighted by edit count. */
export function getWorkingSet(limit = 10): string[] {
  const now = Date.now()
  const active: FileActivity[] = []

  for (const activity of fileActivity.values()) {
    if (now - activity.lastEdited < WORKING_SET_WINDOW_MS) {
      active.push(activity)
    }
  }

  // Sort by recency (most recent first) then by edit count
  active.sort((a, b) => {
    const aScore = a.editCount + (1 / (now - a.lastEdited + 1)) * 1000
    const bScore = b.editCount + (1 / (now - b.lastEdited + 1)) * 1000
    return bScore - aScore
  })

  return active.slice(0, limit).map((a) => a.path)
}

/** Generate a context block showing what the user has been working on. */
export function workingSetContextBlock(): string | null {
  const files = getWorkingSet(5)
  if (files.length === 0) return null

  const now = Date.now()
  const lines = ["[studio working-set] Recently edited files:"]
  for (const file of files) {
    const activity = fileActivity.get(file)
    if (!activity) continue
    const ageMin = Math.floor((now - activity.lastEdited) / 60000)
    const ageStr = ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin}min ago` : `${Math.floor(ageMin / 60)}h ago`
    lines.push(`  ${file} (${activity.editCount} edits, ${ageStr})`)
  }
  return lines.join("\n")
}

/** Prune files older than the window (called on session.idle). */
export function pruneOldFiles(): number {
  const now = Date.now()
  let pruned = 0
  for (const [key, val] of fileActivity) {
    if (now - val.lastEdited > WORKING_SET_WINDOW_MS * 4) {
      // 2 hours — remove completely
      fileActivity.delete(key)
      pruned++
    }
  }
  return pruned
}
