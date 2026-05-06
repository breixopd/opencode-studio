import { Client } from "ssh2"
import { readFileSync } from "fs"
import type { SSHSessionConfig, SSHSession } from "./types"

export interface SSHClientFactory {
  connect(config: SSHSessionConfig): Promise<SSHSession>
}

export class RealSSHClientFactory implements SSHClientFactory {
  async connect(config: SSHSessionConfig): Promise<SSHSession> {
    return new Promise((resolve, reject) => {
      const client = new Client()
      const session: SSHSession = {
        config,
        client,
        alive: true,
        controlPath: `ssh2://${config.user}@${config.host}`,
      }

      client.on("ready", () => {
        session.alive = true
        resolve(session)
      })
      client.on("error", (err) => {
        session.alive = false
        reject(err)
      })
      client.on("close", () => {
        session.alive = false
      })

      client.connect({
        host: config.host,
        port: config.port || 22,
        username: config.user,
        privateKey: readFileSync(config.identityFile, "utf-8"),
        readyTimeout: 10000,
        keepaliveInterval: 30000,
      })
    })
  }
}

// Singleton factory — can be overridden in tests
export let sshFactory: SSHClientFactory = new RealSSHClientFactory()

export function setSSHFactory(factory: SSHClientFactory): void {
  sshFactory = factory
}

export function resetSSHFactory(): void {
  sshFactory = new RealSSHClientFactory()
}
