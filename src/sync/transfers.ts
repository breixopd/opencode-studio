import { existsSync, readdirSync } from "fs"
import { join, relative } from "path"
import type { SSHSession } from "../ssh/types"
import { execCommand } from "../ssh/manager"
import { shellQuote } from "../ssh/quote"
import * as log from "../core/logger"
import { isRelativePathExcluded } from "./excludes"

function walkDirectory(dir: string, localPath: string, excludes: string[]): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    const relPath = relative(localPath, fullPath).replace(/\\/g, "/")
    if (isRelativePathExcluded(relPath, excludes)) continue

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
  await execCommand(session, `mkdir -p ${shellQuote(remotePath)}`)

  const toUpload = walkDirectory(localPath, localPath, excludes)
  log.info(`Starting bulk sync: ${toUpload.length} file(s) from ${localPath}`)

  if (toUpload.length === 0) {
    log.info("Bulk sync complete: no files to upload")
    return
  }

  const sftp = await new Promise<any>((resolve, reject) => {
    session.client.sftp((err, sftp) => {
      if (err) reject(err)
      else resolve(sftp)
    })
  })

  const startTime = Date.now()
  let failed = 0
  let uploaded = 0

  for (const file of toUpload) {
    const localFile = join(localPath, file)
    const remoteFile = join(remotePath, file).replace(/\\/g, "/")
    const remoteDir = remoteFile.split("/").slice(0, -1).join("/")

    try {
      await execCommand(session, `mkdir -p ${shellQuote(remoteDir)}`)

      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localFile, `${remoteFile}.tmp`, (err: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      })

      await execCommand(
        session,
        `mv ${shellQuote(`${remoteFile}.tmp`)} ${shellQuote(remoteFile)}`,
      )
      uploaded++
    } catch {
      /* individual file failed — continue with the rest */
      failed++
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  log.info(`Bulk sync done: ${uploaded} uploaded, ${failed} failed, ${elapsed}s`)

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
  await execCommand(session, `mkdir -p ${shellQuote(remoteDir)}`)

  return new Promise((resolve, reject) => {
    session.client.sftp((err, sftp) => {
      if (err) return reject(err)

      sftp.fastPut(localPath, `${remotePath}.tmp`, (err) => {
        if (err) return reject(err)

        execCommand(
          session,
          `mv ${shellQuote(`${remotePath}.tmp`)} ${shellQuote(remotePath)}`,
        )
          .then(() => resolve())
          .catch(reject)
      })
    })
  })
}

export async function syncDirectory(
  session: SSHSession,
  remotePath: string,
): Promise<void> {
  await execCommand(session, `mkdir -p ${shellQuote(remotePath)}`)
}

export async function deleteRemoteFile(
  session: SSHSession,
  remotePath: string,
  isDirectory = false,
): Promise<void> {
  const flag = isDirectory ? "-rf" : "-f"
  await execCommand(session, `rm ${flag} ${shellQuote(remotePath)}`)
}
