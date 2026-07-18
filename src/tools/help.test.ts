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

  it("overview and tools use catalog toolListText", () => {
    expect(helpText("overview")).toContain("studio_verify")
    expect(helpText("overview")).toContain("/studio-budget")
    expect(helpText("overview")).toContain("/onboard")
    expect(helpText("tools")).toContain("studio_doctor")
  })

  it("workflow documents budget and onboard slash commands", () => {
    const w = helpText("workflow")
    expect(w).toContain("/studio-budget")
    expect(w).toContain("/budget")
    expect(w).toContain("/studio-onboard")
    expect(w).toContain("/onboard")
  })
})
