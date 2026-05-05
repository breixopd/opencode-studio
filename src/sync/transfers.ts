import { spawn } from "child_process"
import { createReadStream } from "fs"
import type { SSHSession } from "../ssh/types"

export async function bulkSync(
  session: SSHSession,
  localPath: string,
  remotePath: string,
  excludes: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const excludeArgs = excludes.flatMap((e) => ["--exclude", e])

    const mkdir = spawn("ssh", [
      "-o",
      `ControlPath=${session.controlPath}`,
      "-o",
      "PasswordAuthentication=no",
      `${session.config.user}@${session.config.host}`,
      `mkdir -p ${remotePath}`,
    ])

    mkdir.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`Failed to create remote directory: ${remotePath}`),
        )

      const tar = spawn(
        "tar",
        ["cf", "-", ...excludeArgs, "-C", localPath, "."],
        { stdio: ["ignore", "pipe", "pipe"] },
      )

      const ssh = spawn(
        "ssh",
        [
          "-o",
          `ControlPath=${session.controlPath}`,
          "-o",
          "PasswordAuthentication=no",
          `${session.config.user}@${session.config.host}`,
          `tar xf - -C ${remotePath}`,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      )

      tar.stdout!.pipe(ssh.stdin!)

      let stderr = ""
      ssh.stderr!.on("data", (d: Buffer) => {
        stderr += d.toString()
      })
      tar.stderr!.on("data", (d: Buffer) => {
        stderr += d.toString()
      })

      ssh.on("close", (code) => {
        if (code === 0) resolve()
        else
          reject(
            new Error(
              `Tar transfer failed: ${stderr.trim() || `exit ${code}`}`,
            ),
          )
      })

      ssh.on("error", reject)
      tar.on("error", reject)
    })

    mkdir.on("error", reject)
  })
}

/**
 * Upload a single file via SSH stream.
 * Atomic write: uploads to .tmp first, then renames.
 */
export async function syncFile(
  session: SSHSession,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = remotePath.split("/").slice(0, -1).join("/") || "/"

    const ssh = spawn(
      "ssh",
      [
        "-o",
        `ControlPath=${session.controlPath}`,
        "-o",
        "PasswordAuthentication=no",
        `${session.config.user}@${session.config.host}`,
        `mkdir -p ${dir} && cat > ${remotePath}.tmp && mv ${remotePath}.tmp ${remotePath}`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    )

    const stream = createReadStream(localPath)
    let stderr = ""
    ssh.stderr!.on("data", (d: Buffer) => {
      stderr += d.toString()
    })

    stream.pipe(ssh.stdin!)

    ssh.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `exit ${code}`))
    })

    ssh.on("error", reject)
    stream.on("error", reject)
  })
}

export async function deleteRemoteFile(
  session: SSHSession,
  remotePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ssh = spawn(
      "ssh",
      [
        "-o",
        `ControlPath=${session.controlPath}`,
        "-o",
        "PasswordAuthentication=no",
        `${session.config.user}@${session.config.host}`,
        `rm -f ${remotePath}`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    )

    let stderr = ""
    ssh.stderr!.on("data", (d: Buffer) => {
      stderr += d.toString()
    })

    ssh.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `exit ${code}`))
    })

    ssh.on("error", reject)
  })
}
