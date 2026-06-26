export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "method"
  | "module"

export interface SymbolEntry {
  name: string
  kind: SymbolKind
  file: string
  line: number
  signature?: string
}

export interface SymbolIndex {
  root: string
  builtAt: string
  fileCount: number
  symbols: SymbolEntry[]
  hash: string
}
