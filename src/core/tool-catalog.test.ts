import { describe, it, expect } from "bun:test"
import {
  TOOL_CATALOG,
  ALL_TOOL_NAMES,
  toolsByCategory,
  toolsByPhase,
  crossCuttingTools,
  findTool,
  phaseList,
  toolListText,
} from "./tool-catalog"

describe("tool-catalog", () => {
  it("has at least 38 tools", () => {
    expect(TOOL_CATALOG.length).toBeGreaterThanOrEqual(38)
    expect(ALL_TOOL_NAMES.length).toBe(TOOL_CATALOG.length)
  })

  it("all tool names start with studio_", () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(name.startsWith("studio_")).toBe(true)
    }
  })

  it("all tools have non-empty descriptions", () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it("all tools belong to a valid category", () => {
    const validCategories = ["Code", "Git", "Web", "SDLC", "Memory", "Config", "Remote", "Cost", "Health"]
    for (const tool of TOOL_CATALOG) {
      expect(validCategories).toContain(tool.category)
    }
  })

  it("toolsByCategory groups correctly", () => {
    const groups = toolsByCategory()
    expect(groups.Code).toBeDefined()
    expect(groups.Code.length).toBeGreaterThan(0)
    expect(groups.SDLC).toBeDefined()
    expect(groups.Memory).toBeDefined()
  })

  it("toolsByPhase groups correctly", () => {
    const phases = toolsByPhase()
    expect(phases[1]).toBeDefined()
    expect(phases[1].length).toBeGreaterThan(0)
    expect(phases[10]).toBeDefined()
    expect(phases[10].some((t) => t.name === "studio_verify")).toBe(true)
  })

  it("crossCuttingTools returns phase=null tools", () => {
    const cc = crossCuttingTools()
    expect(cc.length).toBeGreaterThan(0)
    expect(cc.every((t) => t.phase === null)).toBe(true)
    expect(cc.some((t) => t.name === "studio_cost")).toBe(true)
  })

  it("findTool returns tool by name", () => {
    const tool = findTool("studio_git")
    expect(tool).toBeDefined()
    expect(tool!.name).toBe("studio_git")
    expect(tool!.category).toBe("Git")
  })

  it("findTool returns undefined for unknown tool", () => {
    expect(findTool("studio_nonexistent")).toBeUndefined()
  })

  it("phaseList includes all 11 phases", () => {
    const list = phaseList()
    for (let i = 1; i <= 11; i++) {
      expect(list).toContain(`${i})`)
    }
  })

  it("toolListText includes all categories", () => {
    const text = toolListText()
    expect(text).toContain("Code:")
    expect(text).toContain("Git:")
    expect(text).toContain("SDLC:")
    expect(text).toContain("Memory:")
    expect(text).toContain("Cost:")
  })

  it("no duplicate tool names", () => {
    const names = TOOL_CATALOG.map((t) => t.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })
})
