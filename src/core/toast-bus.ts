/**
 * Pending toast bus for Studio → TUI.
 *
 * Tools/hooks write a single pending toast to disk; the TUI plugin consumes
 * and displays it via ui.toast on session/message events.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import * as log from "./logger"

const TOAST_PATH = join(homedir(), ".config", "opencode-studio", "pending-toast.json")

export type StudioToastVariant = "info" | "success" | "warning" | "error"

export interface StudioToast {
  variant: StudioToastVariant
  title: string
  message: string
  duration?: number
}

export function pendingToastPath(): string {
  return TOAST_PATH
}

/** Write a toast for the TUI to pick up (overwrites any pending toast). */
export function emitStudioToast(toast: StudioToast): void {
  try {
    mkdirSync(dirname(TOAST_PATH), { recursive: true })
    writeFileSync(TOAST_PATH, JSON.stringify(toast), "utf-8")
  } catch (err) {
    log.debugCatch("src/core/toast-bus.ts:emitStudioToast", err)
  }
}

/** Read and delete the pending toast, or null if none. */
export function consumeStudioToast(): StudioToast | null {
  if (!existsSync(TOAST_PATH)) return null
  try {
    const raw = JSON.parse(readFileSync(TOAST_PATH, "utf-8")) as Partial<StudioToast>
    unlinkSync(TOAST_PATH)
    if (!raw || typeof raw.title !== "string" || typeof raw.message !== "string") {
      return null
    }
    const variant = raw.variant ?? "info"
    if (!["info", "success", "warning", "error"].includes(variant)) return null
    return {
      variant: variant as StudioToastVariant,
      title: raw.title,
      message: raw.message,
      duration: typeof raw.duration === "number" ? raw.duration : undefined,
    }
  } catch (err) {
    log.debugCatch("src/core/toast-bus.ts:consumeStudioToast", err)
    try {
      unlinkSync(TOAST_PATH)
    } catch (cleanupErr) {
      log.debugCatch("src/core/toast-bus.ts:consumeStudioToast cleanup", cleanupErr)
    }
    return null
  }
}
