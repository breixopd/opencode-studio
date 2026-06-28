import * as log from "./logger"
/**
 * Multi-language AST via tree-sitter WASM.
 * No third-party indexing services — grammars ship in tree-sitter-wasms.
 *
 * web-tree-sitter is dynamically imported on first use (not at module load).
 * Sessions that never use studio_index/studio_symbols pay zero WASM load cost.
 */
import { createRequire } from "module"
import { dirname, join } from "path"
import type { SymbolKind } from "./code-types"

// Lazily loaded on first use — avoids loading ~500KB WASM at startup.
type TSParser = { parse(content: string): TSTree | null; setLanguage(lang: unknown): void }
type TSTree = { rootNode: TSNode; delete(): void }
type TSNode = {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  namedChildCount: number
  namedChild(i: number): TSNode | null
  childForFieldName(name: string): TSNode | null
  parent: TSNode | null
}
type TSLanguage = { load(path: string): Promise<unknown> }

const require = createRequire(import.meta.url)

export interface AstSymbol {
  name: string
  kind: SymbolKind
  line: number
  endLine: number
  exported: boolean
  signature: string
  parent?: string
}

export interface AstImport {
  from: string
  names: string[]
  line: number
}

export interface AstFileAnalysis {
  symbols: AstSymbol[]
  imports: AstImport[]
  exports: string[]
}

export const EXT_TO_WASM: Record<string, string> = {
  ts: "tree-sitter-typescript",
  tsx: "tree-sitter-tsx",
  js: "tree-sitter-javascript",
  jsx: "tree-sitter-javascript",
  mjs: "tree-sitter-javascript",
  cjs: "tree-sitter-javascript",
  py: "tree-sitter-python",
  pyi: "tree-sitter-python",
  go: "tree-sitter-go",
  rs: "tree-sitter-rust",
  java: "tree-sitter-java",
  rb: "tree-sitter-ruby",
  php: "tree-sitter-php",
  c: "tree-sitter-c",
  h: "tree-sitter-c",
  cpp: "tree-sitter-cpp",
  cc: "tree-sitter-cpp",
  cxx: "tree-sitter-cpp",
  hpp: "tree-sitter-cpp",
  cs: "tree-sitter-c_sharp",
  swift: "tree-sitter-swift",
  kt: "tree-sitter-kotlin",
  kts: "tree-sitter-kotlin",
  lua: "tree-sitter-lua",
  zig: "tree-sitter-zig",
  vue: "tree-sitter-vue",
  scala: "tree-sitter-scala",
  ex: "tree-sitter-elixir",
  exs: "tree-sitter-elixir",
  sh: "tree-sitter-bash",
  bash: "tree-sitter-bash",
  zsh: "tree-sitter-bash",
  html: "tree-sitter-html",
  css: "tree-sitter-css",
  yaml: "tree-sitter-yaml",
  yml: "tree-sitter-yaml",
  toml: "tree-sitter-toml",
  dart: "tree-sitter-dart",
  ml: "tree-sitter-ocaml",
  mli: "tree-sitter-ocaml",
  hs: "tree-sitter-haskell",
  json: "tree-sitter-json",
}

/** Node types that represent definable symbols (cross-language). */
const NODE_KIND: Record<string, SymbolKind> = {
  function_declaration: "function",
  function_definition: "function",
  function_item: "function",
  method_definition: "method",
  method_declaration: "method",
  generator_function_declaration: "function",
  class_declaration: "class",
  class_definition: "class",
  class_item: "class",
  struct_item: "class",
  enum_item: "type",
  enum_declaration: "type",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  type_declaration: "type",
  module_declaration: "module",
  namespace_declaration: "module",
}

let parserReady: Promise<void> | null = null
const langCache = new Map<string, unknown>()
let sharedParser: TSParser | null = null
// Dynamic import holder — loaded on first use via ensureTreeSitter.
let tsModule: { Parser: { init(opts: { locateFile: () => string }): Promise<void>; new (): TSParser }; Language: TSLanguage } | null = null

function wasmPaths(): { runtime: string; grammars: string } {
  const runtimeRoot = dirname(require.resolve("web-tree-sitter/package.json"))
  const grammarsRoot = dirname(require.resolve("tree-sitter-wasms/package.json"))
  return {
    runtime: join(runtimeRoot, "tree-sitter.wasm"),
    grammars: join(grammarsRoot, "out"),
  }
}

export async function ensureTreeSitter(): Promise<TSParser> {
  if (!parserReady) {
    parserReady = (async () => {
      const mod = await import("web-tree-sitter")
      tsModule = mod
      const { runtime } = wasmPaths()
      await mod.Parser.init({ locateFile: () => runtime })
      sharedParser = new mod.Parser()
    })()
  }
  await parserReady
  return sharedParser!
}

async function loadLanguage(ext: string): Promise<unknown | null> {
  const wasmName = EXT_TO_WASM[ext]
  if (!wasmName) return null
  if (langCache.has(wasmName)) return langCache.get(wasmName)!

  await ensureTreeSitter()
  const { grammars } = wasmPaths()
  try {
    const lang = await tsModule!.Language.load(join(grammars, `${wasmName}.wasm`))
    langCache.set(wasmName, lang)
    return lang
  } catch (err) {
      log.debugCatch("src/core/tree-sitter-parser.ts", err);
    /* tree-sitter grammar unavailable — language unsupported */
    return null
  }
}

export function extensionOf(file: string): string {
  const base = file.split("/").pop() ?? file
  const dot = base.lastIndexOf(".")
  if (dot < 1) return ""
  return base.slice(dot + 1).toLowerCase()
}

export function isAstSupported(file: string): boolean {
  return extensionOf(file) in EXT_TO_WASM
}

function nodeLine(node: TSNode): number {
  return node.startPosition.row + 1
}

function nodeEndLine(node: TSNode): number {
  return node.endPosition.row + 1
}

function snippet(node: TSNode, max = 160): string {
  return node.text.replace(/\s+/g, " ").trim().slice(0, max)
}

function symbolName(node: TSNode): string | undefined {
  const byField = node.childForFieldName("name")
  if (byField?.text) return byField.text
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)!
    if (c.type === "identifier" || c.type === "type_identifier" || c.type === "property_identifier") {
      return c.text
    }
  }
  return undefined
}

function extractImports(root: TSNode): AstImport[] {
  const imports: AstImport[] = []
  const visit = (node: TSNode): void => {
    if (
      node.type === "import_statement" ||
      node.type === "import_declaration" ||
      node.type === "import_from_statement"
    ) {
      const from =
        node.childForFieldName("source")?.text?.replace(/['"]/g, "") ??
        node.childForFieldName("module_name")?.text?.replace(/['"]/g, "") ??
        ""
      const names: string[] = []
      const clause = node.childForFieldName("name") ?? node.namedChild(0)
      if (clause?.text) names.push(clause.text.replace(/[{}]/g, "").trim())
      imports.push({ from, names, line: nodeLine(node) })
    }
    for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i)!)
  }
  visit(root)
  return imports
}

function walkSymbols(
  node: TSNode,
  out: AstSymbol[],
  parent: string | undefined,
  exported: boolean,
): void {
  const kind = NODE_KIND[node.type]
  let nextParent = parent

  if (kind) {
    const name = symbolName(node)
    if (name) {
      const isExported =
        exported ||
        node.parent?.type === "export_statement" ||
        node.parent?.type === "export_declaration" ||
        !!node.childForFieldName("name")?.parent

      out.push({
        name,
        kind,
        line: nodeLine(node),
        endLine: nodeEndLine(node),
        exported: isExported,
        signature: snippet(node),
        parent,
      })
      if (kind === "class") nextParent = name
    }
  }

  const isExport = node.type === "export_statement" || node.type === "export_declaration"
  for (let i = 0; i < node.namedChildCount; i++) {
    walkSymbols(node.namedChild(i)!, out, nextParent, exported || isExport)
  }
}

/** Parse any supported language file with tree-sitter AST. */
export async function analyzeWithTreeSitter(
  content: string,
  file: string,
): Promise<AstFileAnalysis | null> {
  const ext = extensionOf(file)
  const lang = await loadLanguage(ext)
  if (!lang) return null

  const parser = await ensureTreeSitter()
  parser.setLanguage(lang)
  const tree = parser.parse(content)
  if (!tree) return null
  const root = tree.rootNode

  const symbols: AstSymbol[] = []
  walkSymbols(root, symbols, undefined, false)

  const imports = extractImports(root)
  const exports = symbols.filter((s) => s.exported).map((s) => s.name)

  return { symbols, imports, exports }
}

export function formatFileOutline(analysis: AstFileAnalysis, file: string): string {
  const lines = [`# ${file}`, ""]
  if (analysis.imports.length) {
    lines.push("## Imports")
    for (const imp of analysis.imports) {
      lines.push(`- ${imp.from} (${imp.names.join(", ") || "—"}) :${imp.line}`)
    }
    lines.push("")
  }
  lines.push("## Symbols (tree-sitter AST)")
  for (const s of analysis.symbols) {
    const exp = s.exported ? "export " : ""
    const parent = s.parent ? `${s.parent}.` : ""
    lines.push(`- ${exp}${s.kind} ${parent}${s.name} :${s.line}-${s.endLine}`)
    if (s.signature) lines.push(`  ${s.signature}`)
  }
  return lines.join("\n")
}
