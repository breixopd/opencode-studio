import { createReadStream, createWriteStream, mkdirSync, statSync } from "fs"
import { dirname, join } from "path"
import { pack, extract } from "tar-stream"
import type { Readable, Writable } from "stream"

export function createTarStream(
  files: Array<{ name: string; path: string }>,
): Readable {
  const packStream = pack()

  for (const file of files) {
    const stat = statSync(file.path)
    const entry = packStream.entry({ name: file.name, size: stat.size })
    createReadStream(file.path).pipe(entry)
  }

  packStream.finalize()
  return packStream
}

export function createTarExtractor(destDir: string): Writable {
  const extractStream = extract()

  extractStream.on("entry", (header, stream, next) => {
    const outputPath = join(destDir, header.name)

    if (header.type === "directory") {
      mkdirSync(outputPath, { recursive: true })
      stream.resume()
      stream.on("end", next)
    } else {
      mkdirSync(dirname(outputPath), { recursive: true })
      const writeStream = createWriteStream(outputPath)
      stream.pipe(writeStream)
      writeStream.on("finish", next)
      writeStream.on("error", next)
    }
  })

  return extractStream
}

export function isWindowsPlatform(): boolean {
  return process.platform === "win32"
}
