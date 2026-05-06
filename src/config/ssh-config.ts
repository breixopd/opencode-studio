import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export interface SSHHost {
  alias: string
  host: string
  user?: string
  identityFile?: string
  port?: number
}

export function parseSSHConfig(configPath?: string): SSHHost[] {
  const path = configPath || join(homedir(), ".ssh", "config")
  if (!existsSync(path)) return []

  const content = readFileSync(path, "utf-8")
  const lines = content.split("\n").map((l) => l.trim())

  const hosts: SSHHost[] = []
  let current: Partial<SSHHost> | null = null
  let currentAliases: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue

    const parts = line.split(/\s+/)
    const key = parts[0]?.toLowerCase()
    const value = parts.slice(1).join(" ")

    if (key === "host") {
      if (current) {
        for (const alias of currentAliases) {
          hosts.push({ alias, ...current } as SSHHost)
        }
      }

      const aliases = value.split(/\s+/).filter((a) => a && !a.includes("*") && !a.includes("?"))
      if (aliases.length === 0) {
        current = null
        currentAliases = []
        continue
      }

      current = {}
      currentAliases = aliases
    } else if (current) {
      switch (key) {
        case "hostname":
          current.host = value
          break
        case "user":
          current.user = value
          break
        case "identityfile":
          current.identityFile = value.replace(/^~/, homedir())
          break
        case "port":
          current.port = parseInt(value, 10)
          break
      }
    }
  }

  if (current) {
    for (const alias of currentAliases) {
      hosts.push({ alias, ...current } as SSHHost)
    }
  }

  return hosts
}
