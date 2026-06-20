export type ProjectMapping = {
  local: string
  remote: string
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

export interface StudioConfig {
  ssh: SSHConfig
  tunnel: TunnelConfig
  projects: Record<string, ProjectMapping>
  defaultExcludes: string[]
}
