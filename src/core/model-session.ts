/** Tracks the model the user picked in the OpenCode UI (per session + last known). */

const bySession = new Map<string, string>()
let lastMainModel: string | undefined

export function setSessionMainModel(sessionID: string, providerID: string, modelID: string): void {
  const ref = `${providerID}/${modelID}`
  bySession.set(sessionID, ref)
  lastMainModel = ref
}

export function getLastMainModel(): string | undefined {
  return lastMainModel
}
