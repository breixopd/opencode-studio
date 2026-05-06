import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createTarStream, createTarExtractor, isWindowsPlatform } from "./archiver"

function pipeToCompletion(source: any, dest: any): Promise<void> {
  return new Promise((resolve, reject) => {
    source.pipe(dest)
    dest.on("finish", resolve)
    dest.on("error", reject)
    source.on("error", reject)
  })
}

describe("archiver", () => {
  let tmpDir: string
  let srcDir: string
  let outDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "archiver-test-"))
    srcDir = join(tmpDir, "src")
    outDir = join(tmpDir, "out")
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(outDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("createTarStream", () => {
    test("returns an object with pipe method", () => {
      writeFileSync(join(srcDir, "a.txt"), "hello")
      const tarStream = createTarStream([
        { name: "a.txt", path: join(srcDir, "a.txt") },
      ])
      expect(typeof tarStream.pipe).toBe("function")
      tarStream.resume()
    })

    test("packed tar can be extracted back", async () => {
      writeFileSync(join(srcDir, "hello.txt"), "Hello World")
      writeFileSync(join(srcDir, "data.bin"), "binary\x00data")

      const tarStream = createTarStream([
        { name: "hello.txt", path: join(srcDir, "hello.txt") },
        { name: "data.bin", path: join(srcDir, "data.bin") },
      ])

      const extractor = createTarExtractor(outDir)
      await pipeToCompletion(tarStream, extractor)

      expect(readFileSync(join(outDir, "hello.txt"), "utf8")).toBe("Hello World")
      expect(readFileSync(join(outDir, "data.bin"))).toEqual(Buffer.from("binary\x00data"))
    })

    test("handles nested directory paths in entry names", async () => {
      mkdirSync(join(srcDir, "sub"), { recursive: true })
      writeFileSync(join(srcDir, "sub", "nested.txt"), "nested content")

      const tarStream = createTarStream([
        { name: "sub/nested.txt", path: join(srcDir, "sub", "nested.txt") },
      ])

      const extractor = createTarExtractor(outDir)
      await pipeToCompletion(tarStream, extractor)

      expect(readFileSync(join(outDir, "sub", "nested.txt"), "utf8")).toBe("nested content")
    })

    test("handles empty files", async () => {
      writeFileSync(join(srcDir, "empty.txt"), "")
      writeFileSync(join(srcDir, "nonempty.txt"), "data")

      const tarStream = createTarStream([
        { name: "empty.txt", path: join(srcDir, "empty.txt") },
        { name: "nonempty.txt", path: join(srcDir, "nonempty.txt") },
      ])

      const extractor = createTarExtractor(outDir)
      await pipeToCompletion(tarStream, extractor)

      expect(readFileSync(join(outDir, "empty.txt"), "utf8")).toBe("")
      expect(readFileSync(join(outDir, "nonempty.txt"), "utf8")).toBe("data")
    })
  })

  describe("createTarExtractor", () => {
    test("extracts multiple files from a tar stream", async () => {
      writeFileSync(join(srcDir, "f1.txt"), "file 1")
      writeFileSync(join(srcDir, "f2.txt"), "file 2")

      const tarStream = createTarStream([
        { name: "f1.txt", path: join(srcDir, "f1.txt") },
        { name: "f2.txt", path: join(srcDir, "f2.txt") },
      ])

      const extractor = createTarExtractor(outDir)
      await pipeToCompletion(tarStream, extractor)

      expect(existsSync(join(outDir, "f1.txt"))).toBe(true)
      expect(existsSync(join(outDir, "f2.txt"))).toBe(true)
    })
  })

  describe("isWindowsPlatform", () => {
    test("returns a boolean", () => {
      expect(typeof isWindowsPlatform()).toBe("boolean")
    })

    test("matches process.platform", () => {
      expect(isWindowsPlatform()).toBe(process.platform === "win32")
    })
  })
})
