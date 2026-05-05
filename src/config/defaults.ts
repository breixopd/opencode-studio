import type { StudioConfig } from "./types"
import { homedir } from "os"
import { join } from "path"

export const DEFAULT_EXCLUDES = [
  ".git/",
  "node_modules/",
  "__pycache__/",
  "*.pyc",
  ".env*",
  ".chunkhound/",
  ".venv/",
  ".mypy_cache/",
  ".pytest_cache/",
]

export const DEFAULT_CONFIG: StudioConfig = {
  ssh: {
    user: "breixopd14",
    host: "skynet-vps",
    identityFile: join(homedir(), ".ssh", "militech_breixopd14"),
  },
  tunnel: {
    localPort: 8443,
    remotePort: 8443,
    host: "skynet-vps",
  },
  projects: {},
  defaultExcludes: DEFAULT_EXCLUDES,
}
