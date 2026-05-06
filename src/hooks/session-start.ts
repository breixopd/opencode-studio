import { loadConfig } from "../config/config"

export function createEventHook() {
  return async (input: { event: any }) => {
    if (input.event.type === "session.created") {
      const config = loadConfig()
      const cwd = process.cwd()
      for (const [name, proj] of Object.entries(config.projects || {})) {
        if ((proj as any).local && (cwd.startsWith((proj as any).local) || (proj as any).local.startsWith(cwd))) {
          console.log(
            `[opencode-studio] Project '${name}' has VPS sync configured. Start with: studio_sync_start({ project: "${name}" })`
          )
          break
        }
      }
    }
  }
}
