import type { Client } from "ssh2"

export interface SSHSessionConfig {
  user: string
  host: string
  identityFile: string
  port?: number
  strictHostChecking?: boolean
}

export interface SSHSession {
  config: SSHSessionConfig
  client: Client
  alive: boolean
  controlPath: string
}
