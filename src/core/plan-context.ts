import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { studioPath, ensureStudioDirs } from "./studio-dir"
import { loadBoulder } from "./tasks"

const MAX_INJECT_CHARS = 12_000

function truncate(text: string, max = MAX_INJECT_CHARS): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n…(truncated — use studio_plan read for full plan)`
}

function extractSections(content: string, headings: string[]): string {
  const lines = content.split("\n")
  const wanted = new Set(headings.map((h) => h.toLowerCase()))
  const chunks: string[] = []
  let current: string[] = []
  let capturing = false
  let currentHeading = ""

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)/)
    if (match) {
      if (capturing && current.length) {
        chunks.push(`## ${currentHeading}\n${current.join("\n").trim()}`)
      }
      currentHeading = match[1].trim()
      capturing = wanted.has(currentHeading.toLowerCase())
      current = []
      continue
    }
    if (capturing) current.push(line)
  }
  if (capturing && current.length) {
    chunks.push(`## ${currentHeading}\n${current.join("\n").trim()}`)
  }
  return chunks.join("\n\n").trim()
}

/** Persist architecture/structure from a plan for long-horizon adherence. */
export function saveArchitectureFromPlan(planContent: string): void {
  ensureStudioDirs()
  const extracted = extractSections(planContent, [
    "Goal",
    "Architecture",
    "File structure",
    "Structure",
  ])
  if (!extracted) return
  writeFileSync(studioPath("architecture.md"), `# Architecture (from active plan)\n\n${extracted}\n`, "utf-8")
}

export function loadArchitectureText(): string | null {
  ensureStudioDirs()
  const path = studioPath("architecture.md")
  if (!existsSync(path)) return null
  const text = readFileSync(path, "utf-8").trim()
  return text || null
}

export function loadActivePlanText(): { name: string; content: string } | null {
  ensureStudioDirs()
  const { planFile } = loadBoulder()
  if (!planFile) return null
  const path = join(studioPath("plans"), planFile)
  if (!existsSync(path)) return null
  const content = readFileSync(path, "utf-8").trim()
  if (!content) return null
  return { name: planFile, content: truncate(content) }
}

export function activePlanContextBlock(): string | null {
  const arch = loadArchitectureText()
  const plan = loadActivePlanText()
  if (!arch && !plan) return null

  const parts: string[] = [
    "[studio plan] Follow the active plan and architecture unless the user says otherwise.",
  ]
  if (arch) parts.push(arch)
  if (plan) parts.push(`## Active plan (${plan.name})\n${plan.content}`)
  return parts.join("\n\n")
}
