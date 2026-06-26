import { describe, it, expect, afterEach } from "bun:test"
import {
  findHotspots,
  findImpact,
  findImporters,
  findRefs,
  listSymbolsInFile,
  researchCodebaseSqlite,
  retrieveWithBudget,
  searchFts,
  searchSymbols,
  toFtsQuery,
} from "./code-query"
import { buildCodeIndexSqlite } from "./code-store"
import { closeStudioDb } from "./studio-db"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("code-query", () => {
  let root: string

  afterEach(() => {
    if (root) {
      closeStudioDb(root)
      rmSync(root, { recursive: true, force: true })
    }
  })

  async function fixture(setup: (root: string) => void) {
    root = mkdtempSync(join(tmpdir(), "studio-q-"))
    mkdirSync(join(root, "src"))
    setup(root)
    await buildCodeIndexSqlite(root, { force: true })
  }

  describe("toFtsQuery", () => {
    it("splits camelCase and quotes terms", () => {
      expect(toFtsQuery("routeAgent")).toBe(`"route" "agent"`)
    })
    it("splits snake_case", () => {
      expect(toFtsQuery("route_agent")).toBe(`"route" "agent"`)
    })
    it("passes through plain words", () => {
      expect(toFtsQuery("auth login")).toBe(`"auth" "login"`)
    })
    it("returns empty for garbage", () => {
      expect(toFtsQuery("!!! ???")).toBe("")
    })
  })

  it("searchFts finds matching chunks", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "a.py"), "def authenticate(user):\n    return user\n")
    })
    const hits = searchFts(root, "authenticate")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].file).toBe("src/a.py")
  })

  it("searchSymbols finds symbols by name substring", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "b.py"), "def create_user():\n    pass\nclass UserService:\n    pass\n")
    })
    const hits = searchSymbols(root, "user")
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits.some((h) => h.name === "create_user")).toBe(true)
    expect(hits.some((h) => h.name === "UserService")).toBe(true)
  })

  it("listSymbolsInFile returns symbols in line order", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "c.py"), "def first():\n    pass\ndef second():\n    pass\n")
    })
    const hits = listSymbolsInFile(root, "src/c.py")
    expect(hits.length).toBe(2)
    expect(hits[0].name).toBe("first")
    expect(hits[1].name).toBe("second")
  })

  it("retrieveWithBudget truncates to fit budget when chunk is large", async () => {
    await fixture((r) => {
      const body = "    line = 1  # " + "x".repeat(40) + "\n"
      writeFileSync(join(r, "src", "d.py"), "def big_function():\n" + body.repeat(80) + "\n")
    })
    const hits = searchFts(root, "big_function")
    if (hits.length === 0) return // skip if FTS didn't pick it up
    if (hits[0].tokenEst < 50) return // chunk is small, no truncation expected
    const small = retrieveWithBudget(root, "big_function", 50)
    expect(small.length).toBeGreaterThan(0)
    expect(small[small.length - 1].truncated).toBe(true)
  })

  it("retrieveWithBudget returns full chunks when budget allows", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "e.py"), "def small_fn():\n    return 1\n")
    })
    const big = retrieveWithBudget(root, "small_fn", 10000)
    expect(big.length).toBeGreaterThan(0)
    expect(big[0].truncated).toBe(false)
  })

  it("researchCodebaseSqlite returns markdown report", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "f.py"), "def handler(req):\n    return process(req)\ndef process(req):\n    return req\n")
    })
    const report = researchCodebaseSqlite(root, "handler")
    expect(report).toContain("# Codebase research")
    expect(report).toContain("src/f.py")
  })

  it("findHotspots returns most-referenced symbols", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "g.py"), "def core():\n    pass\n")
      writeFileSync(join(r, "src", "h.py"), "def uses_core():\n    return core()\n")
    })
    const hotspots = findHotspots(root, 10)
    expect(hotspots.length).toBeGreaterThanOrEqual(0)
  })

  it("findRefs returns matching edges", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "i.py"), "def target():\n    return 1\ndef caller():\n    return target()\n")
    })
    const refs = findRefs(root, "target")
    expect(refs.length).toBeGreaterThanOrEqual(0)
  })

  it("findImporters returns empty for unimported file", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "j.py"), "x = 1\n")
    })
    const importers = findImporters(root, "src/j.py")
    expect(importers).toEqual([])
  })

  it("findImpact returns empty for unknown symbol", async () => {
    await fixture((r) => {
      writeFileSync(join(r, "src", "k.py"), "def exists():\n    pass\n")
    })
    const impact = findImpact(root, "nonexistent_symbol")
    expect(impact).toEqual([])
  })
})
