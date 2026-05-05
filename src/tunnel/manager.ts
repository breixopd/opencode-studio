import { spawn, type ChildProcess } from "child_process"
import { createServer } from "net"
import { join } from "path"
import { tmpdir } from "os"

export interface TunnelConfig {
  user: string
  host: string
  identityFile: string
  localPort: number
  remotePort: number
}

export interface TunnelState {
  config: TunnelConfig
  process: ChildProcess | null
  alive: boolean
  startTime: number | null
  lastHeartbeat: number
  lastError: string | null
}

// Singleton — one SSH tunnel per process.
let tunnelState: TunnelState | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/** Check if a local port is available (not bound) */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true))
    })
    server.on("error", () => resolve(false))
  })
}

/** Find an available port starting from preferred, incrementing up to maxAttempts */
export async function findAvailablePort(
  preferred: number,
  maxAttempts: number = 5,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i
    if (await isPortAvailable(port)) return port
  }
  throw new Error(
    `No available port found starting from ${preferred} (tried ${maxAttempts} ports)`,
  )
}

/** Start an SSH tunnel as a child process with auto-reconnect */
export async function startTunnel(config: TunnelConfig): Promise<TunnelState> {
  if (tunnelState?.alive) {
    throw new Error(
      `Tunnel is already running on port ${tunnelState.config.localPort}`,
    )
  }

  const port = await findAvailablePort(config.localPort)
  if (port !== config.localPort) {
    console.warn(
      `[studio-tunnel] Port ${config.localPort} occupied, using port ${port}`,
    )
  }

  const controlPath = join(
    tmpdir(),
    `studio-tunnel-${config.user}@${config.host}`,
  )

  const sshArgs = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "TCPKeepAlive=yes",
    "-o", `ControlPath=${controlPath}`,
    "-i", config.identityFile,
    "-L", `${port}:localhost:${config.remotePort}`,
    "-N",
    `${config.user}@${config.host}`,
  ]

  const proc = spawn("ssh", sshArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  })

  tunnelState = {
    config: { ...config, localPort: port },
    process: proc,
    alive: true,
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    lastError: null,
  }

  proc.on("close", (code) => {
    if (!tunnelState) return
    tunnelState.alive = false
    tunnelState.lastError = `SSH process exited with code ${code}`
    console.error(
      `[studio-tunnel] Tunnel died (exit ${code}), auto-restart in 10s...`,
    )

    setTimeout(() => {
      if (tunnelState && !tunnelState.alive) {
        startTunnel({ ...config, localPort: port }).catch((err) => {
          console.error(`[studio-tunnel] Auto-restart failed:`, err.message)
        })
      }
    }, 10_000)
  })

  proc.stderr?.on("data", (chunk: Buffer) => {
    if (tunnelState) tunnelState.lastError = chunk.toString()
  })

  startHeartbeat()

  return tunnelState
}

/** Start heartbeat monitoring (clears any existing heartbeat) */
function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)

  heartbeatTimer = setInterval(async () => {
    if (!tunnelState?.alive) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      return
    }

    const portFree = await isPortAvailable(tunnelState.config.localPort)
    if (portFree) {
      tunnelState.alive = false
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    } else {
      tunnelState.lastHeartbeat = Date.now()
    }
  }, 15_000)
}

/** Stop the SSH tunnel (SIGTERM then SIGKILL after 5s). */
export function stopTunnel(): boolean {
  if (!tunnelState?.process) return false

  tunnelState.alive = false

  try {
    tunnelState.process.kill("SIGTERM")
  } catch {
    // Process already dead.
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  const proc = tunnelState.process
  setTimeout(() => {
    try {
      proc.kill("SIGKILL")
    } catch {
      // Already gone.
    }
  }, 5_000)

  tunnelState = null
  return true
}

/** Check if tunnel is alive */
export function isTunnelAlive(): boolean {
  return tunnelState?.alive === true && tunnelState.process !== null
}

/** Get current tunnel state (returns a copy to prevent mutation) */
export function getTunnelState(): TunnelState | null {
  return tunnelState ? { ...tunnelState } : null
}

/** Reset internal state — exposed for testing */
export function _resetTunnelState(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  tunnelState = null
}
