import { spawn, type ChildProcess } from "child_process"
import { tmpdir } from "os"
import { join } from "path"
import { existsSync, createReadStream } from "fs"
import type { SSHSession, SSHSessionConfig } from "./types"

export function createSession(config: SSHSessionConfig): SSHSession {
  const controlPath = join(tmpdir(), `studio-ssh-${config.user}@${config.host}`)

  const args = [
    "-o", `ControlMaster=auto`,
    "-o", `ControlPath=${controlPath}`,
    "-o", "ControlPersist=60",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "PasswordAuthentication=no",
    "-i", config.identityFile,
    "-N",
    `${config.user}@${config.host}`,
  ]

  const proc = spawn("ssh", args, {
    stdio: ["pipe", "pipe", "pipe"],
  })

  return { config, process: proc, controlPath, alive: true }
}

export async function execCommand(session: SSHSession, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-o", `ControlPath=${session.controlPath}`,
      "-o", "PasswordAuthentication=no",
      `${session.config.user}@${session.config.host}`,
      command,
    ]
    const proc = spawn("ssh", args)
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `exit ${code}`))
    })
    proc.on("error", reject)
  })
}

export async function uploadFile(session: SSHSession, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!existsSync(localPath)) return reject(new Error(`File not found: ${localPath}`))

    const args = [
      "-o", `ControlPath=${session.controlPath}`,
      "-o", "PasswordAuthentication=no",
      `${session.config.user}@${session.config.host}`,
      `cat > ${remotePath}.tmp && mv ${remotePath}.tmp ${remotePath}`,
    ]
    const proc = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] })

    const stream = createReadStream(localPath)
    let stderr = ""
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })
    stream.pipe(proc.stdin!)
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `exit ${code}`))
    })
    proc.on("error", reject)
    stream.on("error", reject)
  })
}

export async function closeSession(session: SSHSession): Promise<void> {
  return new Promise((resolve) => {
    session.alive = false
    try { session.process.kill("SIGTERM") } catch {}
    setTimeout(() => {
      try { session.process.kill("SIGKILL") } catch {}
      resolve()
    }, 2000)
  })
}
