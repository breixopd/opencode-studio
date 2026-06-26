import type { PlanStep, StudioPlan } from "./workspace-types"

function section(content: string, heading: string): string {
  const lines = content.split("\n")
  const wanted = heading.toLowerCase()
  const out: string[] = []
  let capture = false

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)/)
    if (match) {
      capture = match[1].trim().toLowerCase() === wanted
      continue
    }
    if (capture) out.push(line)
  }
  return out.join("\n").trim()
}

function bulletLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean)
}

function parseSteps(text: string): PlanStep[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^- \[[ xX]\]/.test(l))
    .map((l) => {
      const done = /^- \[[xX]\]/.test(l)
      const text = l.replace(/^- \[[ xX]\]\s*/, "").trim()
      return { text, done }
    })
}

export function parseMarkdownPlan(id: string, title: string, markdown: string, now: string): StudioPlan {
  return {
    id,
    title,
    goal: section(markdown, "Goal"),
    research: bulletLines(section(markdown, "Research (docs & examples)") || section(markdown, "Research")),
    architecture: section(markdown, "Architecture"),
    fileStructure: section(markdown, "File structure") || section(markdown, "Structure"),
    steps: parseSteps(section(markdown, "Steps")),
    acceptance: bulletLines(section(markdown, "Acceptance criteria")),
    edgeCases: section(markdown, "Edge cases & risks") || section(markdown, "Edge cases"),
    testStrategy: section(markdown, "Test strategy"),
    revisions: [],
    createdAt: now,
    updatedAt: now,
  }
}

export const PLAN_MARKDOWN_TEMPLATE = `# Plan

## Goal


## Research (docs & examples)
- 

## Architecture


## File structure


## Steps
- [ ] 

## Acceptance criteria
- 

## Edge cases & risks


## Test strategy


`

export function formatPlanAsMarkdown(plan: StudioPlan): string {
  const lines = [
    `# ${plan.title}`,
    "",
    "## Goal",
    plan.goal || "",
    "",
    "## Research (docs & examples)",
    ...plan.research.map((r) => `- ${r}`),
    "",
    "## Architecture",
    plan.architecture || "",
    "",
    "## File structure",
    plan.fileStructure || "",
    "",
    "## Steps",
    ...plan.steps.map((s) => `- [${s.done ? "x" : " "}] ${s.text}`),
    "",
    "## Acceptance criteria",
    ...plan.acceptance.map((a) => `- ${a}`),
    "",
    "## Edge cases & risks",
    plan.edgeCases || "",
    "",
    "## Test strategy",
    plan.testStrategy || "",
  ]

  if (plan.revisions.length) {
    lines.push("", "## Revisions")
    for (const rev of plan.revisions) {
      lines.push(`### ${rev.at} — ${rev.reason}`, rev.note, "")
    }
  }

  return lines.join("\n").trim() + "\n"
}

export function architectureBlock(plan: StudioPlan): string {
  const parts: string[] = []
  if (plan.goal) parts.push(`## Goal\n${plan.goal}`)
  if (plan.architecture) parts.push(`## Architecture\n${plan.architecture}`)
  if (plan.fileStructure) parts.push(`## File structure\n${plan.fileStructure}`)
  return parts.join("\n\n")
}
