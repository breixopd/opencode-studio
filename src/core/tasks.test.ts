import { describe, it, expect, afterEach } from "bun:test"
import { rmSync, existsSync } from "fs"
import { join } from "path"
import { createTask, listTasks, updateTask, incompleteTasks } from "./tasks"

const ROOT = join(process.cwd(), ".studio")

afterEach(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
})

describe("tasks", () => {
  it("creates and completes tasks", () => {
    const t = createTask("Fix sync", ["tests pass"])
    expect(t.status).toBe("pending")
    updateTask(t.id, { status: "in_progress" })
    updateTask(t.id, { status: "done" })
    expect(incompleteTasks()).toHaveLength(0)
    expect(listTasks()).toHaveLength(1)
  })
})
