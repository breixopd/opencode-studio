import { describe, it, expect, afterEach } from "bun:test"
import { ParsePool } from "./parse-pool"
import { buildCodeIndexSqlite } from "./code-store"
import { closeStudioDb } from "./studio-db"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("parse-pool", () => {
  const pools: ParsePool[] = []
  let root: string | undefined

  afterEach(async () => {
    while (pools.length) {
      await pools.pop()!.close()
    }
    if (root) {
      closeStudioDb(root)
      rmSync(root, { recursive: true, force: true })
      root = undefined
    }
  })

  it("creates OS workers and parses python", async () => {
    const pool = await ParsePool.create(2)
    pools.push(pool)
    expect(pool.mode).toBe("workers")
    expect(pool.workerCount).toBe(2)

    const ast = await pool.analyze(
      "def greet(name):\n    return name\nclass Box:\n    pass\n",
      "demo.py",
    )
    expect(ast).not.toBeNull()
    expect(ast!.symbols.some((s) => s.name === "greet")).toBe(true)
    expect(ast!.symbols.some((s) => s.name === "Box")).toBe(true)
  })

  it("inline mode when size=0", async () => {
    const pool = await ParsePool.create(0)
    pools.push(pool)
    expect(pool.mode).toBe("inline")
    expect(pool.workerCount).toBe(0)
    const ast = await pool.analyze("def x():\n    pass\n", "x.py")
    expect(ast!.symbols[0]?.name).toBe("x")
  })

  it("parallel analyze across workers", async () => {
    const pool = await ParsePool.create(3)
    pools.push(pool)
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        pool.analyze(`def fn_${i}():\n    return ${i}\n`, `f${i}.py`),
      ),
    )
    expect(results.every((r) => r && r.symbols.length >= 1)).toBe(true)
  })

  it("index build reports treesitter-workers", async () => {
    root = mkdtempSync(join(tmpdir(), "studio-workers-"))
    mkdirSync(join(root, "src"))
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(root, "src", `w${i}.py`), `def w_${i}():\n    pass\n`)
    }
    const stats = await buildCodeIndexSqlite(root, { force: true, concurrency: 2 })
    expect(stats.parseMode).toBe("workers")
    expect(stats.parseWorkers).toBe(2)
    expect(stats.parser).toBe("treesitter-workers")
    expect(stats.fileCount).toBe(4)
    expect(stats.symbolCount).toBeGreaterThanOrEqual(4)
  })
})
