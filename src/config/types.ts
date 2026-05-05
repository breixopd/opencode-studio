export interface ProjectMapping {
  local: string
  remote: string
  excludes: string[]
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
  strictHostChecking?: boolean
}

export interface StudioConfig {
  ssh: SSHConfig
  tunnel: TunnelConfig
  projects: Record<string, ProjectMapping>
  defaultExcludes: string[]
}
