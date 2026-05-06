import { existsSync, readdirSync } from "fs"
import { join, relative, sep } from "path"
import type { SSHSession } from "../ssh/types"
import { execCommand } from "../ssh/manager"

function walkDirectory(
  dir: string,
  localPath: string,
  excludes: string[],
): string[] {
  const files: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relPath = relative(localPath, fullPath)

    const isExcluded = excludes.some((e) => {
      const pattern = e.replace(/\/$/, "")
      return (
        relPath === pattern ||
        relPath.startsWith(pattern + sep) ||
        entry.name === pattern
      )
    })
    if (isExcluded) continue

    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath, localPath, excludes))
    } else if (entry.isFile()) {
      files.push(relPath)
    }
  }

  return files
}

export async function bulkSync(
  session: SSHSession,
  localPath: string,
  remotePath: string,
  excludes: string[],
): Promise<void> {
  await execCommand(session, `mkdir -p ${remotePath}`)

  const toUpload = walkDirectory(localPath, localPath, excludes)
  if (toUpload.length === 0) return

  const sftp = await new Promise<any>((resolve, reject) => {
    session.client.sftp((err, sftp) => {
      if (err) reject(err)
      else resolve(sftp)
    })
  })

  let failed = 0
  for (const file of toUpload) {
    const localFile = join(localPath, file)
    const remoteFile = join(remotePath, file).replace(/\\/g, "/")
    const remoteDir = remoteFile.split("/").slice(0, -1).join("/")

    try {
      await execCommand(session, `mkdir -p ${remoteDir}`)

      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localFile, `${remoteFile}.tmp`, (err: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      })

      await execCommand(session, `mv ${remoteFile}.tmp ${remoteFile}`)
    } catch {
      failed++
    }
  }

  if (failed > 0) {
    throw new Error(`${failed} of ${toUpload.length} files failed to sync`)
  }
}

export async function syncFile(
  session: SSHSession,
  localPath: string,
  remotePath: string,
): Promise<void> {
  if (!existsSync(localPath)) {
    throw new Error(`File not found: ${localPath}`)
  }

  const remoteDir = remotePath.split("/").slice(0, -1).join("/") || "/"
  await execCommand(session, `mkdir -p ${remoteDir}`)

  return new Promise((resolve, reject) => {
    session.client.sftp((err, sftp) => {
      if (err) return reject(err)

      sftp.fastPut(localPath, `${remotePath}.tmp`, (err) => {
        if (err) return reject(err)

        execCommand(session, `mv ${remotePath}.tmp ${remotePath}`)
          .then(() => resolve())
          .catch(reject)
      })
    })
  })
}

export async function deleteRemoteFile(
  session: SSHSession,
  remotePath: string,
): Promise<void> {
  await execCommand(session, `rm -f ${remotePath}`)
}
