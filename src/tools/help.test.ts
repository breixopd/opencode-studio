import { describe, it, expect } from "bun:test"
import { helpText } from "./help"

describe("studio_help", () => {
  it("lists topics", () => {
    expect(helpText()).toContain("overview")
    expect(helpText()).toContain("code")
  })

  it("returns topic content", () => {
    expect(helpText("code")).toContain("studio_glob")
    expect(helpText("search")).toContain("DuckDuckGo")
    expect(helpText("search")).toContain("TAVILY_API_KEY")
  })
})
