import { existsSync } from "fs"
import type { SSHSession, SSHSessionConfig } from "./types"
import { sshFactory } from "./factory"
import { shellQuote } from "./quote"

export async function createSession(config: SSHSessionConfig): Promise<SSHSession> {
  return sshFactory.connect(config)
}

export async function execCommand(session: SSHSession, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    session.client.exec(command, (err, stream) => {
      if (err) return reject(err)
      let stdout = ""
      let stderr = ""
      stream.on("data", (data: Buffer) => {
        stdout += data.toString()
      })
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString()
      })
      stream.on("close", (code: number) => {
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(stderr.trim() || `exit ${code}`))
      })
    })
  })
}

export async function uploadFile(session: SSHSession, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!existsSync(localPath)) return reject(new Error(`File not found: ${localPath}`))

    session.client.sftp((err, sftp) => {
      if (err) return reject(err)

      sftp.fastPut(localPath, `${remotePath}.tmp`, (err) => {
        if (err) return reject(err)

        execCommand(session, `mv ${shellQuote(`${remotePath}.tmp`)} ${shellQuote(remotePath)}`)
          .then(() => resolve())
          .catch(reject)
      })
    })
  })
}

export async function closeSession(session: SSHSession): Promise<void> {
  session.alive = false
  session.client.end()
}
