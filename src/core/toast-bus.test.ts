import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, unlinkSync } from "fs"
import {
  emitStudioToast,
  consumeStudioToast,
  pendingToastPath,
} from "./toast-bus"

describe("toast-bus", () => {
  beforeEach(() => {
    consumeStudioToast()
  })

  afterEach(() => {
    const path = pendingToastPath()
    if (existsSync(path)) unlinkSync(path)
  })

  it("emits and consumes a toast once", () => {
    emitStudioToast({
      variant: "warning",
      title: "Full autonomy — risk accepted",
      message: "Remote exec may be unrestricted.",
      duration: 8000,
    })
    expect(existsSync(pendingToastPath())).toBe(true)

    const toast = consumeStudioToast()
    expect(toast).toEqual({
      variant: "warning",
      title: "Full autonomy — risk accepted",
      message: "Remote exec may be unrestricted.",
      duration: 8000,
    })
    expect(consumeStudioToast()).toBeNull()
    expect(existsSync(pendingToastPath())).toBe(false)
  })

  it("returns null when no pending toast", () => {
    expect(consumeStudioToast()).toBeNull()
  })

  it("overwrites previous pending toast", () => {
    emitStudioToast({ variant: "info", title: "A", message: "1" })
    emitStudioToast({ variant: "error", title: "B", message: "2" })
    const toast = consumeStudioToast()
    expect(toast?.title).toBe("B")
    expect(toast?.variant).toBe("error")
  })
})
