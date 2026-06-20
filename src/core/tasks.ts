import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import { studioPath, ensureStudioDirs } from "./studio-dir"

export type TaskStatus = "pending" | "in_progress" | "done" | "blocked"

export interface StudioTask {
  id: string
  title: string
  status: TaskStatus
  acceptance?: string[]
  notes?: string
  created: string
  updated: string
}

export interface BoulderState {
  planFile?: string
  activeTaskIds: string[]
  updatedAt: string
}

function taskFile(id: string): string {
  return studioPath("tasks", `${id}.json`)
}

function boulderFile(): string {
  return studioPath("boulder.json")
}

export function listTasks(): StudioTask[] {
  ensureStudioDirs()
  const dir = studioPath("tasks")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as StudioTask)
    .sort((a, b) => a.created.localeCompare(b.created))
}

export function getTask(id: string): StudioTask | null {
  const path = taskFile(id)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf-8"))
}

export function saveTask(task: StudioTask): void {
  ensureStudioDirs()
  writeFileSync(taskFile(task.id), JSON.stringify(task, null, 2))
}

export function createTask(title: string, acceptance?: string[]): StudioTask {
  const now = new Date().toISOString()
  const task: StudioTask = {
    id: randomUUID().slice(0, 8),
    title,
    status: "pending",
    acceptance,
    created: now,
    updated: now,
  }
  saveTask(task)
  return task
}

export function updateTask(
  id: string,
  patch: Partial<Pick<StudioTask, "title" | "status" | "acceptance" | "notes">>,
): StudioTask {
  const task = getTask(id)
  if (!task) throw new Error(`Task not found: ${id}`)
  Object.assign(task, patch, { updated: new Date().toISOString() })
  saveTask(task)
  return task
}

export function incompleteTasks(): StudioTask[] {
  return listTasks().filter((t) => t.status === "pending" || t.status === "in_progress")
}

export function loadBoulder(): BoulderState {
  ensureStudioDirs()
  const path = boulderFile()
  if (!existsSync(path)) {
    return { activeTaskIds: [], updatedAt: new Date().toISOString() }
  }
  return JSON.parse(readFileSync(path, "utf-8"))
}

export function saveBoulder(state: BoulderState): void {
  ensureStudioDirs()
  state.updatedAt = new Date().toISOString()
  writeFileSync(boulderFile(), JSON.stringify(state, null, 2))
}

export function setActiveTasks(ids: string[]): void {
  const b = loadBoulder()
  b.activeTaskIds = ids
  saveBoulder(b)
}
