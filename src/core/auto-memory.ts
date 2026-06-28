/**
 * Agent-driven auto-memory — like Claude Code's auto-memory.
 *
 * The agent itself decides what's worth remembering (not just regex matching).
 * Memories are organized into topics: debugging, conventions, architecture,
 * build-commands, preferences. Only the MEMORY.md index is loaded at session
 * start; topic files are read on demand by the agent.
 *
 * Storage: `.studio/memory/MEMORY.md` (index) + `.studio/memory/<topic>.md`
 * Scope: per-project (git-repo based, shared across worktrees).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "fs"
import { join } from "path"
import { studioRoot } from "./studio-dir"
import * as log from "./logger"

const MEMORY_DIR = "memory"
const INDEX_FILE = "MEMORY.md"
const MAX_INDEX_LINES = 200

export type MemoryTopic =
  | "debugging"
  | "conventions"
  | "architecture"
  | "build-commands"
  | "preferences"
  | "insights"

const TOPIC_DESCRIPTIONS: Record<MemoryTopic, string> = {
  debugging: "Debugging insights — what broke, how to fix, gotchas",
  conventions: "Project conventions — naming, structure, patterns",
  architecture: "Architecture notes — how the system works, design decisions",
  "build-commands": "Build/test/lint commands and their quirks",
  preferences: "User preferences — coding style, tools, workflow habits",
  insights: "General insights — performance, security, edge cases",
}

export interface MemoryEntry {
  topic: MemoryTopic
  content: string
  source: "agent" | "user-correction" | "pattern-detected"
  createdAt: string
}

function memoryDir(): string {
  return join(studioRoot(), MEMORY_DIR)
}

function memoryIndexPath(): string {
  return join(memoryDir(), INDEX_FILE)
}

function memoryTopicPath(topic: MemoryTopic): string {
  return join(memoryDir(), `${topic}.md`)
}

/** Ensure the memory directory exists. */
function ensureMemoryDir(): void {
  const dir = memoryDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Save a memory entry. The agent calls this when it learns something worth
 * remembering. Written to both the topic file and the index.
 */
export function saveMemory(entry: MemoryEntry): string {
  ensureMemoryDir()

  // Append to the topic file (detailed notes).
  const topicPath = memoryTopicPath(entry.topic)
  const topicHeader = `## ${entry.content.slice(0, 60)}\n`
  const topicBody = `- **Source:** ${entry.source}\n- **Date:** ${entry.createdAt}\n- **Note:** ${entry.content}\n\n`
  appendFileSync(topicPath, topicHeader + topicBody, "utf-8")

  // Append to the index (concise summary, loaded at startup).
  const indexLine = `- [${entry.topic}] ${entry.content.slice(0, 120)}\n`
  appendFileSync(memoryIndexPath(), indexLine, "utf-8")

  // Truncate index if too long (keep first MAX_INDEX_LINES).
  trimIndex()

  log.info(`Memory saved [${entry.topic}]: ${entry.content.slice(0, 80)}`)
  return `Memory saved to ${entry.topic}.md: ${entry.content.slice(0, 100)}`
}

/**
 * Read the memory index (loaded at session start — concise, ≤200 lines).
 * Topic files are read on demand by the agent using studio_remember.
 */
export function readMemoryIndex(): string | null {
  const path = memoryIndexPath()
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, "utf-8")
    const lines = content.split("\n")
    if (lines.length > MAX_INDEX_LINES) {
      return lines.slice(0, MAX_INDEX_LINES).join("\n") + "\n\n…(truncated — read topic files for details)"
    }
    return content
  } catch (err) {
      log.debugCatch("src/core/auto-memory.ts", err);
    return null
  }
}

/** Read a specific topic file. */
export function readMemoryTopic(topic: MemoryTopic): string | null {
  const path = memoryTopicPath(topic)
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, "utf-8")
  } catch (err) {
      log.debugCatch("src/core/auto-memory.ts", err);
    return null
  }
}

/** List all memory topics that have files. */
export function listMemoryTopics(): Array<{ topic: MemoryTopic; lines: number }> {
  const topics: Array<{ topic: MemoryTopic; lines: number }> = []
  for (const topic of Object.keys(TOPIC_DESCRIPTIONS) as MemoryTopic[]) {
    const path = memoryTopicPath(topic)
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8")
      topics.push({ topic, lines: content.split("\n").length })
    }
  }
  return topics
}

/** Check if a memory already contains similar content (dedup). */
export function hasSimilarMemory(content: string, topic?: MemoryTopic): boolean {
  const topics = topic ? [topic] : (Object.keys(TOPIC_DESCRIPTIONS) as MemoryTopic[])
  const lower = content.toLowerCase().slice(0, 80)
  for (const t of topics) {
    const path = memoryTopicPath(t)
    if (!existsSync(path)) continue
    try {
      const existing = readFileSync(path, "utf-8").toLowerCase()
      if (existing.includes(lower)) return true
    } catch (err) {
      log.debugCatch("src/core/auto-memory.ts", err);
      /* skip */
    }
  }
  return false
}

/**
 * Generate a memory context block for the session.
 * Only the index is loaded (token-cheap). Reminds the agent that topic
 * files are available on demand.
 */
export function memoryContextBlock(): string | null {
  const index = readMemoryIndex()
  const topics = listMemoryTopics()
  if (!index && topics.length === 0) return null

  const lines = ["[studio memory] Auto-memory index:"]
  if (index) {
    lines.push(index)
  }
  if (topics.length > 0) {
    lines.push("")
    lines.push("Topic files (read on demand with studio_remember action=topic):")
    for (const t of topics) {
      lines.push(`  ${t.topic} (${t.lines} lines) — ${TOPIC_DESCRIPTIONS[t.topic]}`)
    }
  }
  return lines.join("\n")
}

/** Trim the index file to MAX_INDEX_LINES, keeping the most recent entries. */
function trimIndex(): void {
  const path = memoryIndexPath()
  if (!existsSync(path)) return
  try {
    const content = readFileSync(path, "utf-8")
    const lines = content.split("\n")
    if (lines.length > MAX_INDEX_LINES) {
      // Keep the last MAX_INDEX_LINES (most recent are at the bottom).
      const trimmed = lines.slice(-MAX_INDEX_LINES).join("\n")
      writeFileSync(path, trimmed, "utf-8")
    }
  } catch (err) {
      log.debugCatch("src/core/auto-memory.ts", err);
    /* best-effort */
  }
}

/**
 * Smart scope routing — decide whether a correction is project-specific
 * or a global preference, and route accordingly.
 *
 * Heuristic:
 * - Mentions project files/tools/paths → project rule
 * - Mentions general coding philosophy → global rule
 * - Mentions specific package managers/build tools → project rule
 * - Default → project rule (safer, local scope)
 */
export function routeScope(rule: string): "project" | "global" {
  const lower = rule.toLowerCase()

  // Global signals: general coding philosophy, universal preferences
  const globalSignals = [
    "always write", "never commit", "always test", "prefer",
    "always use", "never use", "always prefer", "follow solid",
    "clean code", "functional style", "always document",
  ]
  if (globalSignals.some((s) => lower.includes(s))) {
    return "global"
  }

  // Project signals: mention specific files, paths, tools
  const projectSignals = [
    "src/", "test/", "package.json", "cargo.toml", "pyproject", "go.mod",
    "dockerfile", "this repo", "this project", "the config",
    ".env", "migration", "this api", "the database",
  ]
  if (projectSignals.some((s) => lower.includes(s))) {
    return "project"
  }

  // Default: project (safer)
  return "project"
}

/**
 * Track corrections across sessions and detect patterns.
 * If the same type of correction repeats ≥3 times, suggest making it permanent.
 */
export interface CorrectionPattern {
  rule: string
  count: number
  firstSeen: string
  lastSeen: string
  scope: "project" | "global"
}

const PATTERN_FILE = "correction-patterns.json"

function patternPath(): string {
  return join(memoryDir(), PATTERN_FILE)
}

/** Record a user correction and check if it's a recurring pattern. */
export function recordCorrection(rule: string, scope: "project" | "global"): {
  isRecurring: boolean
  count: number
  suggestion?: string
} {
  ensureMemoryDir()
  const path = patternPath()
  let patterns: CorrectionPattern[] = []
  try {
    if (existsSync(path)) {
      patterns = JSON.parse(readFileSync(path, "utf-8")) as CorrectionPattern[]
    }
  } catch (err) {
      log.debugCatch("src/core/auto-memory.ts", err);
    /* corrupt file — start fresh */
  }

  const now = new Date().toISOString()
  const lower = rule.toLowerCase().slice(0, 60)
  const existing = patterns.find((p) => p.rule.toLowerCase().slice(0, 60) === lower)

  if (existing) {
    existing.count++
    existing.lastSeen = now
    existing.scope = scope
  } else {
    patterns.push({ rule, count: 1, firstSeen: now, lastSeen: now, scope })
  }

  writeFileSync(path, JSON.stringify(patterns, null, 2), "utf-8")

  const count = existing?.count ?? 1
  if (count >= 3) {
    return {
      isRecurring: true,
      count,
      suggestion: `You've corrected this ${count} times. Make it a permanent ${scope} rule? Run: studio_remember add "${rule}" scope=${scope}`,
    }
  }

  return { isRecurring: false, count }
}

/** Get recurring patterns for the discipline hook to surface. */
export function getRecurringPatterns(): CorrectionPattern[] | null {
  const path = patternPath()
  if (!existsSync(path)) return null
  try {
    const patterns = JSON.parse(readFileSync(path, "utf-8")) as CorrectionPattern[]
    return patterns.filter((p) => p.count >= 3).slice(0, 3)
  } catch (err) {
      log.debugCatch("src/core/auto-memory.ts", err);
    return null
  }
}
