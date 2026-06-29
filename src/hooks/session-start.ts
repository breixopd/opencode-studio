import { autoStartSyncIfNeeded, autoStartTunnelIfNeeded } from "../core/auto"
import { touchProjectProfile, updateProjectBrief } from "../core/project-profile"
import { prefetchZenCatalog } from "../core/model-routing"
import { prefetchCodeIndex } from "../core/code-index"
import { createModelFallbackEventHandler } from "./model-fallback"
import { recordCostEvent } from "../core/cost"
import { clearSessionDeduper } from "../core/dedup-session"
import { captureDiagnostics, clearDiagnosticsForFiles, pruneStaleDiagnostics, type DiagnosticEntry } from "../core/diagnostics"
import { detectTooling } from "../core/project-detect"
import { handleFileEdited, handleSessionIdle } from "./maintenance-impl"
import * as log from "../core/logger"
import { syncRulesToAgentsMd } from "../core/agents-md-sync"
import { syncAgentProfiles } from "../core/agent-profiles"
import { ensureStudioGitignored } from "../core/gitignore"
import { trackFileEdit, pruneOldFiles } from "../core/passive-context"

const handleFallback = createModelFallbackEventHandler()

/** Type guard: is this event a message.updated with an assistant message? */
function isAssistantMessageUpdate(
  event: unknown,
): event is {
  type: "message.updated"
  properties: {
    info: {
      id: string
      sessionID: string
      role: string
      providerID: string
      modelID: string
      cost: number
      tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
      time: { created: number }
      path?: { cwd: string; root: string }
    }
  }
} {
  if (typeof event !== "object" || event === null) return false
  const e = event as { type?: string; properties?: { info?: { role?: string } } }
  return e.type === "message.updated" && e.properties?.info?.role === "assistant"
}

export function createEventHook() {
  return async (input: { event: { type: string; properties?: unknown } }) => {
    // Debug-trace every event OpenCode sends (shows actual event shapes for diagnosis)
    log.debugEvent(input.event.type, input.event.properties)

    // Model fallback handler — only on relevant events, wrapped to prevent crashes.
    if (input.event.type === "message.updated" || input.event.type === "session.error") {
      try {
        await handleFallback(input as unknown as Parameters<typeof handleFallback>[0])
      } catch (err) {
        log.debugCatch("handleFallback", err)
      }
    }

    // Cost ledger: capture token usage from assistant message updates.
    if (input.event.type === "message.updated" && isAssistantMessageUpdate(input.event)) {
      try {
        const msg = input.event.properties.info
        log.debug("cost", `Capturing cost event: model=${msg.providerID}/${msg.modelID} cost=$${msg.cost?.toFixed(4) ?? "?"} tokens_in=${msg.tokens?.input ?? "?"} tokens_out=${msg.tokens?.output ?? "?"}`)
        recordCostEvent(msg)
      } catch (err) {
        log.debugCatch("recordCostEvent", err)
      }
    }

    // LSP diagnostics: capture type/lint errors in real-time.
    if (input.event.type === "lsp.client.diagnostics") {
      try {
        const props = input.event.properties as {
          uri?: string
          file?: string
          diagnostics?: Array<{
            range?: { start?: { line?: number; character?: number } }
            severity?: number
            source?: string
            message?: string
          }>
        } | undefined

        log.debug("lsp", `Diagnostics event: ${props?.diagnostics?.length ?? 0} entries for ${props?.uri ?? props?.file ?? "(unknown)"}`)

        if (!props?.diagnostics?.length) {
          const file = props?.uri?.replace("file://", "") ?? props?.file
          if (file) clearDiagnosticsForFiles(process.cwd(), [file])
          return
        }

        const file = (props.uri ?? props.file ?? "").replace("file://", "")
        if (!file) return

        const entries: DiagnosticEntry[] = props.diagnostics
          .filter((d) => d.message)
          .map((d) => ({
            file,
            line: (d.range?.start?.line ?? 0) + 1,
            col: (d.range?.start?.character ?? 0) + 1,
            severity: severityFromLsp(d.severity ?? 1),
            source: d.source ?? null,
            message: d.message!,
          }))

        captureDiagnostics(process.cwd(), entries)
        log.debug("lsp", `Captured ${entries.length} diagnostic entries for ${file}`)
      } catch (err) {
        log.debugCatch("lsp.diagnostics", err)
      }
    }

    // Smart maintenance: file.edited → debounced reindex, session.idle → prune.
    if (input.event.type === "file.edited") {
      const props = input.event.properties as { path?: string; file?: string } | undefined
      const filePath = props?.path ?? props?.file
      if (filePath) {
        handleFileEdited(filePath)
        trackFileEdit(filePath)
      }
      return
    }

    if (input.event.type === "session.idle") {
      handleSessionIdle()
      pruneOldFiles()
      return
    }

    // Clean up dedup state on session deletion.
    if (input.event.type === "session.deleted") {
      const props = input.event.properties as { sessionID?: string } | undefined
      if (props?.sessionID) clearSessionDeduper(props.sessionID)
    }

    // Sync studio rules to AGENTS.md on session creation only (not every message).
    if (input.event.type === "session.created") {
      try {
        const synced = syncRulesToAgentsMd(process.cwd())
        if (synced) log.info("Rules synced to AGENTS.md")
      } catch (err) {
      log.debugCatch("src/hooks/session-start.ts", err);
        /* best-effort sync */
      }
    }

    // Sync OpenCode's todo system with studio tasks.
    if (input.event.type === "todo.updated") {
      try {
        const props = input.event.properties as {
          todo?: { content?: string; status?: string }
        } | undefined
        const todo = props?.todo
        // OpenCode todo → studio task sync is a future enhancement.
        // For now we observe but don't auto-create tasks.
        if (todo?.content) {
          log.debug(`OpenCode todo updated: ${todo.content} (${todo.status})`)
        }
      } catch (err) {
      log.debugCatch("src/hooks/session-start.ts", err);
        /* best-effort todo sync */
      }
    }

    if (input.event.type !== "session.created") return

    // Ensure studio files are gitignored (unless user opted in).
    try {
      const { loadUserProfile } = require("../core/project-profile")
      const profile = loadUserProfile()
      ensureStudioGitignored(process.cwd(), profile.commitStudio ?? false)
    } catch (err) {
      log.debugCatch("src/hooks/session-start.ts", err);
      ensureStudioGitignored(process.cwd(), false)
    }

    // Sync agent profiles to .opencode/agents/ (dynamic — derived from AGENT_DEFS).
    try {
      syncAgentProfiles(process.cwd())
    } catch (err) {
      log.debugCatch("src/hooks/session-start.ts", err);
      /* best-effort */
    }

    // Auto-detect project type + conventions on session start.
    try {
      const tooling = detectTooling(process.cwd())
      if (tooling.conventions.length) {
        // Merge detected conventions into the profile (dedupes with existing).
        const profile = touchProjectProfile()
        const existing = new Set(profile.conventions.map((c) => c.toLowerCase()))
        const newConventions = tooling.conventions.filter((c) => !existing.has(c.toLowerCase()))
        if (newConventions.length) {
          updateProjectBrief({ conventions: [...profile.conventions, ...newConventions] })
          log.info(`Auto-detected ${newConventions.length} convention(s) for ${tooling.projectType.ecosystem}`)
        }
      }
    } catch (err) {
      log.debugCatch("src/hooks/session-start.ts", err);
      /* best-effort convention detection */
    }

    // Prune stale diagnostics on session start.
    try {
      pruneStaleDiagnostics(process.cwd())
    } catch (err) {
      log.debugCatch("src/hooks/session-start.ts", err);
      /* best-effort */
    }

    try {
      prefetchZenCatalog()
      prefetchCodeIndex().catch(() => {})
      await autoStartTunnelIfNeeded()
      const started = await autoStartSyncIfNeeded()
      if (started) {
        log.info(`Auto-sync started for '${started}'`)
      }
    } catch (err) {
      log.debugCatch("src/hooks/session-start.ts", err);
      /* best-effort prefetch/auto-start — never block session start */
    }
  }
}

function severityFromLsp(severity: number): string {
  switch (severity) {
    case 1: return "error"
    case 2: return "warning"
    case 3: return "info"
    case 4: return "hint"
    default: return "error"
  }
}
