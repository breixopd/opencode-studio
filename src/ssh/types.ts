import type { ChildProcess } from "child_process"

export interface SSHSessionConfig {
  user: string
  host: string
  identityFile: string
  port?: number
  strictHostChecking?: boolean
}

export interface SSHSession {
  config: SSHSessionConfig
  process: ChildProcess
  controlPath: string
  alive: boolean
}
