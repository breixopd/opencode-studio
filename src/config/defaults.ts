import type { StudioConfig } from "./types"

export const DEFAULT_EXCLUDES = [
  ".git/",
  ".studio/",
  "node_modules/",
  "__pycache__/",
  "*.pyc",
  ".env*",
  ".venv/",
  ".mypy_cache/",
  ".pytest_cache/",
]

export const DEFAULT_CONFIG: StudioConfig = {
  ssh: {
    user: "",
    host: "",
    identityFile: "",
  },
  tunnel: {
    localPort: 8443,
    remotePort: 8443,
    host: "",
  },
  projects: {},
  defaultExcludes: DEFAULT_EXCLUDES,
}
