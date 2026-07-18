import { describe, it, expect, mock, beforeEach } from "bun:test"

const mockCanHandoff = mock((_force?: boolean) => ({ ok: true as boolean, reason: undefined as string | undefined }))
const mockAssertBudget = mock((_tool: string, _sessionID?: string) => {})
const mockGetActiveTasks = mock(() => [] as Array<{ title: string; status: string }>)

mock.module("../core/workspace", () => ({
  canHandoff: mockCanHandoff,
  getActiveTasks: mockGetActiveTasks,
}))

mock.module("../core/budget", () => ({
  assertBudgetAllowsTool: mockAssertBudget,
}))

const { createToolGuardsHook } = await import("./tool-guards")

describe("tool-guards", () => {
  beforeEach(() => {
    mockCanHandoff.mockClear()
    mockAssertBudget.mockClear()
    mockGetActiveTasks.mockClear()
    mockCanHandoff.mockReturnValue({ ok: true, reason: undefined })
    mockAssertBudget.mockImplementation(() => {})
    mockGetActiveTasks.mockReturnValue([])
  })

  it("blocks handoff when canHandoff fails", async () => {
    mockCanHandoff.mockReturnValue({ ok: false, reason: "studio_verify has not passed" })
    const hook = createToolGuardsHook()
    await expect(
      hook({ tool: "studio_handoff", sessionID: "s1" }, { args: {} }),
    ).rejects.toThrow(/Handoff blocked/)
    expect(mockCanHandoff).toHaveBeenCalledWith(false)
  })

  it("allows handoff when force:true and gate ok", async () => {
    mockCanHandoff.mockReturnValue({ ok: true, reason: undefined })
    const hook = createToolGuardsHook()
    await expect(
      hook({ tool: "studio_handoff" }, { args: { force: true } }),
    ).resolves.toBeUndefined()
    expect(mockCanHandoff).toHaveBeenCalledWith(true)
  })

  it("propagates budget block from assertBudgetAllowsTool", async () => {
    mockAssertBudget.mockImplementation((tool: string) => {
      if (tool === "studio_search") throw new Error("Session budget exceeded")
    })
    const hook = createToolGuardsHook()
    await expect(
      hook({ tool: "studio_search", sessionID: "s1" }, { args: {} }),
    ).rejects.toThrow(/Session budget exceeded/)
    expect(mockAssertBudget).toHaveBeenCalledWith("studio_search", "s1")
  })

  it("does not call canHandoff for non-handoff tools", async () => {
    const hook = createToolGuardsHook()
    await hook({ tool: "studio_verify" }, { args: {} })
    expect(mockCanHandoff).not.toHaveBeenCalled()
  })
})
