import { describe, it, expect } from "bun:test"
import { ALL_TOOL_NAMES } from "./core/tool-catalog"
import { REGISTERED_TOOLS } from "./index"

describe("tool registration", () => {
  it("REGISTERED_TOOLS matches ALL_TOOL_NAMES exactly", () => {
    const registered = Object.keys(REGISTERED_TOOLS).sort()
    const catalog = [...ALL_TOOL_NAMES].sort()
    expect(registered).toEqual(catalog)
  })

  it("every registered tool is a callable definition", () => {
    for (const [name, def] of Object.entries(REGISTERED_TOOLS)) {
      expect(name.startsWith("studio_")).toBe(true)
      expect(def).toBeDefined()
      expect(typeof (def as { execute?: unknown }).execute).toBe("function")
    }
  })
})
