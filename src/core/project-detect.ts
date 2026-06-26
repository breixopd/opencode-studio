/**
 * Language-agnostic project type detection.
 *
 * Scans for ALL project markers (not just Node) and returns:
 *   - Primary language + ecosystem
 *   - Verify commands (test/lint/typecheck/build) per ecosystem
 *   - Formatter detection
 *   - Linter detection
 *   - Auto-detected conventions text
 *
 * This makes studio_verify work for ANY project type — Python, Rust, Go, Java,
 * Ruby, PHP, C/C++, Elixir, .NET, Dart, etc. — with zero manual config.
 */
import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"

export interface ProjectType {
  /** Primary ecosystem label, e.g. "Python", "Rust", "Go", "Node" */
  ecosystem: string
  /** Package manager / runner, e.g. "bun", "cargo", "go", "pytest" */
  runner: string
  /** Detect confidence (high if multiple markers found) */
  confidence: "high" | "medium" | "low"
  /** All detected markers (files that matched) */
  markers: string[]
}

export interface VerifyCommands {
  test: string | null
  lint: string | null
  typecheck: string | null
  build: string | null
}

export interface ToolingDetection {
  projectType: ProjectType
  verifyCommands: VerifyCommands
  formatter: string | null
  linter: string | null
  conventions: string[]
}

// ——— Marker definitions ————————————————————————————————

interface Marker {
  files: string[]
  ecosystem: string
}

const ECOSYSTEM_MARKERS: Marker[] = [
  // Node ecosystem (check first — most common in opencode users)
  { files: ["bun.lock"], ecosystem: "Bun" },
  { files: ["package.json"], ecosystem: "Node" },
  { files: ["deno.json", "deno.jsonc"], ecosystem: "Deno" },
  // Python
  { files: ["pyproject.toml"], ecosystem: "Python" },
  { files: ["setup.py", "setup.cfg"], ecosystem: "Python" },
  { files: ["requirements.txt", "requirements-dev.txt"], ecosystem: "Python" },
  { files: ["Pipfile"], ecosystem: "Python" },
  { files: ["poetry.lock"], ecosystem: "Python" },
  // Rust
  { files: ["Cargo.toml"], ecosystem: "Rust" },
  // Go
  { files: ["go.mod"], ecosystem: "Go" },
  // Java/JVM
  { files: ["pom.xml"], ecosystem: "Java/Maven" },
  { files: ["build.gradle", "build.gradle.kts"], ecosystem: "Java/Gradle" },
  // Ruby
  { files: ["Gemfile"], ecosystem: "Ruby" },
  { files: ["Rakefile"], ecosystem: "Ruby" },
  // PHP
  { files: ["composer.json"], ecosystem: "PHP" },
  // C/C++
  { files: ["CMakeLists.txt"], ecosystem: "C/C++ (CMake)" },
  { files: ["Makefile"], ecosystem: "C/C++ (Make)" },
  { files: ["meson.build"], ecosystem: "C/C++ (Meson)" },
  // .NET
  { files: [".csproj", ".sln"], ecosystem: ".NET" }, // checked by extension below
  // Elixir
  { files: ["mix.exs"], ecosystem: "Elixir" },
  // Dart/Flutter
  { files: ["pubspec.yaml"], ecosystem: "Dart" },
  // Swift
  { files: ["Package.swift"], ecosystem: "Swift" },
  // Haskell
  { files: ["cabal.project", "*.cabal"], ecosystem: "Haskell" },
  // Zig
  { files: ["build.zig"], ecosystem: "Zig" },
  // Lua
  { files: ["rockspec"], ecosystem: "Lua" },
]

/** Ecosystem-specific verify commands. Keys are ecosystem prefixes. */
const VERIFY_COMMANDS: Record<string, VerifyCommands> = {
  Bun: { test: "bun test", lint: "bun run lint", typecheck: "bun run typecheck", build: "bun run build" },
  Node: { test: "npm test", lint: "npm run lint", typecheck: "npm run typecheck", build: "npm run build" },
  Deno: { test: "deno task test", lint: "deno lint", typecheck: "deno check", build: "deno task build" },
  Python: { test: "pytest", lint: "ruff check .", typecheck: "mypy .", build: null },
  Rust: { test: "cargo test", lint: "cargo clippy", typecheck: null, build: "cargo build" },
  Go: { test: "go test ./...", lint: "golangci-lint run", typecheck: "go vet ./...", build: "go build ./..." },
  "Java/Maven": {
    test: "mvn test",
    lint: "mvn checkstyle:check",
    typecheck: "mvn compile",
    build: "mvn package -DskipTests",
  },
  "Java/Gradle": {
    test: "gradle test",
    lint: "gradle checkstyleMain",
    typecheck: "gradle compileJava",
    build: "gradle build -x test",
  },
  Ruby: { test: "rake test", lint: "rubocop", typecheck: null, build: null },
  PHP: { test: "phpunit", lint: "php-cs-fixer fix --dry-run", typecheck: "phpstan", build: null },
  "C/C++ (CMake)": { test: "ctest", lint: null, typecheck: null, build: "cmake --build build" },
  "C/C++ (Make)": { test: "make test", lint: null, typecheck: null, build: "make" },
  "C/C++ (Meson)": { test: "meson test -C build", lint: null, typecheck: null, build: "meson compile -C build" },
  ".NET": { test: "dotnet test", lint: "dotnet format --verify-no-changes", typecheck: null, build: "dotnet build" },
  Elixir: { test: "mix test", lint: "mix credo", typecheck: null, build: "mix compile" },
  Dart: { test: "dart test", lint: "dart analyze", typecheck: "dart analyze", build: "dart compile exe" },
  Swift: { test: "swift test", lint: "swiftlint", typecheck: null, build: "swift build" },
  Haskell: { test: "cabal test", lint: "hlint .", typecheck: null, build: "cabal build" },
  Zig: { test: "zig build test", lint: null, typecheck: null, build: "zig build" },
  Lua: { test: "busted", lint: "luacheck .", typecheck: null, build: null },
}

// ——— Formatter detection ————————————————————————————————

const FORMATTERS: Array<[string[], string]> = [
  [["prettier", ".prettierrc", ".prettierrc.json", "prettier.config.js", "prettier.config.mjs"], "prettier"],
  [[".eslintrc", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs"], "eslint"],
  [["ruff.toml"], "ruff"],
  [["pyproject.toml"], "ruff/python"],  // ruff often in pyproject
  [[".rustfmt.toml", "rustfmt.toml"], "rustfmt"],
  [[".golangci.yml", ".golangci.yaml"], "golangci-lint"],
  [["mypy.ini", ".mypy_cache"], "mypy"],
  [[".rubocop.yml"], "rubocop"],
  [["phpstan.neon"], "phpstan"],
  [[".php-cs-fixer.php", ".php-cs-fixer.dist.php"], "php-cs-fixer"],
  [["deno.json", "deno.jsonc"], "deno fmt"],
  [[".editorconfig"], "editorconfig"],
  [["CMakeLists.txt"], "clang-format (if .clang-format)"],
]

// ——— Detection functions ————————————————————————————————

export function detectProjectType(root: string): ProjectType {
  const found: string[] = []
  let ecosystem = "Unknown"
  let confidence: "high" | "medium" | "low" = "low"

  for (const marker of ECOSYSTEM_MARKERS) {
    for (const file of marker.files) {
      if (file.startsWith("*")) {
        const ext = file.slice(1)
        try {
          const entries = readdirSync(root)
          if (entries.some((e: string) => e.endsWith(ext))) {
            if (!found.includes(marker.ecosystem)) {
              found.push(marker.ecosystem)
              if (ecosystem === "Unknown") ecosystem = marker.ecosystem
            }
          }
        } catch {
          /* ignore */
        }
      } else if (existsSync(join(root, file))) {
        if (!found.includes(marker.ecosystem)) {
          found.push(marker.ecosystem)
          if (ecosystem === "Unknown") ecosystem = marker.ecosystem
        }
      }
    }
  }

  // .NET: check for *.csproj or *.sln
  if (ecosystem === "Unknown") {
    try {
      const entries = readdirSync(root)
      if (entries.some((e: string) => e.endsWith(".csproj") || e.endsWith(".sln"))) {
        ecosystem = ".NET"
        found.push(".NET")
      }
    } catch {
      /* ignore */
    }
  }

  if (found.length >= 2) confidence = "high"
  else if (found.length === 1) confidence = "medium"

  // Runner maps to verify command prefix
  const runner = ecosystem.split(" ")[0].toLowerCase()

  return { ecosystem, runner, confidence, markers: found }
}

export function detectVerifyCommands(root: string, ecosystem: string): VerifyCommands {
  // First check for npm/bun scripts in package.json (overrides ecosystem defaults)
  if (ecosystem === "Bun" || ecosystem === "Node" || ecosystem === "Deno") {
    try {
      const pkgPath = join(root, "package.json")
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
        const scripts = pkg.scripts ?? {}
        return {
          test: scripts.test ?? null,
          lint: scripts.lint ?? null,
          typecheck: scripts.typecheck ?? null,
          build: scripts.build ?? null,
        }
      }
    } catch {
      /* fall through to ecosystem defaults */
    }
  }

  // Deno: use deno.json tasks if present
  if (ecosystem === "Deno") {
    const verify = VERIFY_COMMANDS["Deno"]
    try {
      for (const f of ["deno.json", "deno.jsonc"]) {
        const p = join(root, f)
        if (existsSync(p)) {
          const cfg = JSON.parse(readFileSync(p, "utf-8"))
          const tasks = cfg.tasks ?? {}
          return {
            test: tasks.test ?? verify.test,
            lint: tasks.lint ?? verify.lint,
            typecheck: tasks.check ?? verify.typecheck,
            build: tasks.build ?? verify.build,
          }
        }
      }
    } catch {
      /* fall through */
    }
  }

  // Python: check if pytest is configured, or use unittest fallback
  if (ecosystem === "Python") {
    const base = VERIFY_COMMANDS["Python"]
    // Check if ruff is configured — if not, don't include lint
    const hasRuff = existsSync(join(root, "ruff.toml")) ||
      existsSync(join(root, ".ruff.toml")) ||
      pyprojectHasSection(root, "tool.ruff")
    const hasMypy = existsSync(join(root, "mypy.ini")) ||
      pyprojectHasSection(root, "tool.mypy")
    return {
      test: base.test,
      lint: hasRuff ? base.lint : null,
      typecheck: hasMypy ? base.typecheck : null,
      build: null,
    }
  }

  // Rust: always has the same commands
  if (ecosystem === "Rust") return VERIFY_COMMANDS["Rust"]

  // Go: use go.mod
  if (ecosystem === "Go") {
    const base = VERIFY_COMMANDS["Go"]
    // Check for golangci-lint config
    const hasLint = existsSync(join(root, ".golangci.yml")) || existsSync(join(root, ".golangci.yaml"))
    return { ...base, lint: hasLint ? base.lint : null }
  }

  // Look up by ecosystem prefix
  for (const key of Object.keys(VERIFY_COMMANDS)) {
    if (ecosystem.startsWith(key)) return VERIFY_COMMANDS[key]
  }

  // Fallback: Makefile
  if (existsSync(join(root, "Makefile"))) return VERIFY_COMMANDS["C/C++ (Make)"]

  return { test: null, lint: null, typecheck: null, build: null }
}

function pyprojectHasSection(root: string, section: string): boolean {
  try {
    const content = readFileSync(join(root, "pyproject.toml"), "utf-8")
    return content.includes(`[${section}]`)
  } catch {
    return false
  }
}

export function detectFormatter(root: string): string | null {
  for (const [files, label] of FORMATTERS) {
    for (const file of files) {
      if (existsSync(join(root, file))) {
        // For pyproject.toml, only match if it's ruff — other tools use the same file
        if (file === "pyproject.toml") {
          if (!pyprojectHasSection(root, "tool.ruff") && !pyprojectHasSection(root, "tool.black")) continue
          if (pyprojectHasSection(root, "tool.ruff")) return "ruff format"
          if (pyprojectHasSection(root, "tool.black")) return "black"
          continue
        }
        return label
      }
    }
  }
  return null
}

export function detectConventions(root: string, ecosystem: string): string[] {
  const conventions: string[] = []

  const formatter = detectFormatter(root)
  if (formatter) conventions.push(`Formatter: ${formatter}`)

  if (existsSync(join(root, ".editorconfig"))) {
    conventions.push("EditorConfig present — respect indentation/style settings")
  }

  // Ecosystem-specific conventions
  switch (ecosystem) {
    case "Rust":
      conventions.push("Use clippy for linting, rustfmt for formatting")
      break
    case "Go":
      conventions.push("Use gofmt/gofumpt, keep imports sorted with goimports")
      break
    case "Python":
      if (conventions.some((c) => c.includes("ruff"))) conventions.push("Use ruff for linting + formatting")
      conventions.push("Prefer type hints, use pathlib over os.path")
      break
    case "Bun":
    case "Node":
      if (formatter === "prettier") conventions.push("Format with prettier before commits")
      if (formatter === "eslint") conventions.push("Lint with eslint, fix issues before handoff")
      break
  }

  // Check for CODEOWNERS
  if (existsSync(join(root, "CODEOWNERS")) || existsSync(join(root, ".github", "CODEOWNERS"))) {
    conventions.push("CODEOWNERS file present — respect ownership for reviewed files")
  }

  // Check for CONTRIBUTING.md
  if (existsSync(join(root, "CONTRIBUTING.md"))) {
    conventions.push("CONTRIBUTING.md present — follow project contribution guidelines")
  }

  return conventions
}

/** Full tooling detection — used by session-start hook to auto-configure. */
export function detectTooling(root: string): ToolingDetection {
  const projectType = detectProjectType(root)
  const verifyCommands = detectVerifyCommands(root, projectType.ecosystem)
  const formatter = detectFormatter(root)
  const conventions = detectConventions(root, projectType.ecosystem)
  return { projectType, verifyCommands, formatter, linter: formatter, conventions }
}
