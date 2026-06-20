import { autoStartSyncIfNeeded, autoStartTunnelIfNeeded } from "../core/auto"

export function createEventHook() {
  return async (input: { event: { type: string } }) => {
    if (input.event.type !== "session.created") return

    await autoStartTunnelIfNeeded()
    const started = await autoStartSyncIfNeeded()
    if (started) {
      console.log(`[opencode-studio] Auto-sync started for '${started}'`)
    }
  }
}
