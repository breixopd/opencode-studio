import { describe, it, expect } from "bun:test"
import { analyzeWithTreeSitter } from "./code-ast"

describe("tree-sitter AST", () => {
  it("extracts Python functions and classes", async () => {
    const src = "def greet():\n  pass\nclass Foo:\n  pass\n"
    const result = await analyzeWithTreeSitter(src, "test.py")
    expect(result).not.toBeNull()
    expect(result!.symbols.some((s) => s.name === "greet")).toBe(true)
    expect(result!.symbols.some((s) => s.name === "Foo")).toBe(true)
  })

  it("extracts TypeScript exports", async () => {
    const src = "export function hello() {}\nexport class Bar {}\n"
    const result = await analyzeWithTreeSitter(src, "test.ts")
    expect(result!.symbols.some((s) => s.name === "hello")).toBe(true)
    expect(result!.symbols.some((s) => s.name === "Bar")).toBe(true)
  })
})
