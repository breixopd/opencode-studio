export type ProjectMapping = {
  local: string
  remote: string
  /** Multi-remote support (Phase 6.2). Keys are env names like "dev", "staging". */
  remotes?: Record<string, { remote: string; ssh?: Partial<SSHConfig> }>
  excludes: string[]
  /** When true, `.studio/` is not auto-added to .gitignore */
  commitStudio?: boolean
}

export interface TunnelConfig {
  localPort: number
  remotePort: number
  host: string
}

export interface SSHConfig {
  user: string
  host: string
  identityFile: string
  port?: number
}

/** Remote exec policy for studio_remote. Empty arrays = unrestricted (subject to blocklist). */
export interface RemoteExecConfig {
  /** SSH host aliases permitted for studio_remote. */
  allowedHosts?: string[]
  /** Command must start with one of these prefixes when non-empty. */
  allowedCommandPrefixes?: string[]
}

export interface StudioConfig {
  ssh: SSHConfig
  tunnel: TunnelConfig
  projects: Record<string, ProjectMapping>
  defaultExcludes: string[]
  /** Optional SSH exec allowlists (hosts + command prefixes). */
  remote?: RemoteExecConfig
}
