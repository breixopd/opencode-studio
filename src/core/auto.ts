import { existsSync, readFileSync } from "fs"
import { basename, join } from "path"
import { loadConfig, saveConfig } from "../config/config"
import { parseSSHConfig } from "../config/ssh-config"
import type { StudioConfig } from "../config/types"
import * as log from "./logger"
import { getActiveSyncProjects } from "../sync/active"
import { isTunnelAlive, startTunnel } from "../tunnel/manager"
import { ensureStudioGitignored } from "./gitignore"

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"))
}

function projectNameForDir(dir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"))
    if (pkg.name && typeof pkg.name === "string") {
      return pkg.name.replace(/^@/, "").replace(/\//g, "-")
    }
  } catch (err) {
      log.debugCatch("src/core/auto.ts", err);
    // no package.json
  }
  return basename(dir)
}

function defaultRemotePath(config: StudioConfig, projectName: string): string {
  const user = config.ssh.user || "dev"
  return `/home/${user}/${projectName}`
}

function findProjectForCwd(config: StudioConfig, cwd: string): [string, StudioConfig["projects"][string]] | null {
  for (const [name, proj] of Object.entries(config.projects)) {
    if (cwd === proj.local || cwd.startsWith(proj.local + "/")) {
      return [name, proj]
    }
  }
  return null
}

/** Silent first-run: detect SSH host, map cwd → remote project */
export function ensureStudioReady(cwd = process.cwd()): StudioConfig {
  let config = loadConfig()

  if (!config.ssh.host) {
    const hosts = parseSSHConfig()
    const first = hosts.find((h) => h.identityFile && h.host) || hosts[0]
    if (first) {
      config = {
        ...config,
        ssh: {
          user: first.user || "",
          host: first.host || first.alias,
          identityFile: first.identityFile || "",
          port: first.port,
        },
        tunnel: { ...config.tunnel, host: first.host || first.alias },
      }
      saveConfig(config)
    }
  }

  if (isGitRepo(cwd) && !findProjectForCwd(config, cwd)) {
    const name = projectNameForDir(cwd)
    if (!config.projects[name]) {
      config.projects[name] = {
        local: cwd,
        remote: defaultRemotePath(config, name),
        excludes: [...config.defaultExcludes],
      }
      saveConfig(config)
      ensureStudioGitignored(cwd, false)
    }
  }

  return loadConfig()
}

export async function autoStartTunnelIfNeeded(): Promise<void> {
  const config = ensureStudioReady()
  if (!config.ssh.host || !config.ssh.identityFile || isTunnelAlive()) return
  try {
    await startTunnel({
      user: config.ssh.user,
      host: config.tunnel.host || config.ssh.host,
      identityFile: config.ssh.identityFile,
      localPort: config.tunnel.localPort,
      remotePort: config.tunnel.remotePort,
    })
  } catch (err) {
    log.warn(`Auto-tunnel skipped: ${(err as Error).message}`)
  }
}

export async function autoStartSyncIfNeeded(cwd = process.cwd()): Promise<string | null> {
  const config = ensureStudioReady(cwd)
  if (!config.ssh.host || !config.ssh.identityFile) return null

  const match = findProjectForCwd(config, cwd)
  if (!match) return null

  const [name] = match
  if (getActiveSyncProjects().includes(name)) return name

  try {
    // Lazy import avoids core→tools dependency inversion.
    const { startProjectSync } = await import("../tools/sync")
    await startProjectSync(name)
    return name
  } catch (err) {
    log.warn(`Auto-sync skipped for '${name}': ${(err as Error).message}`)
    return null
  }
}
