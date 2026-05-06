import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export function createConfigHook() {
  return async () => {
    const configPath = join(homedir(), ".config", "opencode-studio", "config.json")
    if (!existsSync(configPath)) {
      console.log("[opencode-studio] First run detected. Run studio_setup to configure remote dev.")
    }
  }
}
