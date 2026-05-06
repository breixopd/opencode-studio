import { createServer, type Server, type Socket } from "net"
import type { SSHSession } from "../ssh/types"
import { sshFactory } from "../ssh/factory"

export interface TunnelConfig {
  user: string
  host: string
  identityFile: string
  localPort: number
  remotePort: number
}

export interface TunnelState {
  config: TunnelConfig
  alive: boolean
  startTime: number | null
  lastHeartbeat: number
  lastError: string | null
}

let tunnelSession: SSHSession | null = null
let localServer: Server | null = null
let currentTunnelConfig: TunnelConfig | null = null
let currentPort = 0
let startTime: number | null = null
let lastHeartbeatValue = Date.now()
let lastErrorValue: string | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true))
    })
    server.on("error", () => resolve(false))
  })
}

export async function findAvailablePort(
  preferred: number,
  maxAttempts = 5,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i
    if (await isPortAvailable(port)) return port
  }
  throw new Error(
    `No available port found starting from ${preferred} (tried ${maxAttempts} ports)`,
  )
}

// ---------------------------------------------------------------------------
// Tunnel lifecycle
// ---------------------------------------------------------------------------

/**
 * Start an SSH tunnel via ssh2 with port forwarding.
 *
 * Uses sshFactory.connect() to establish the SSH session, then creates a local
 * TCP server that forwards each incoming connection through the SSH tunnel via
 * client.forwardOut().  Auto-reconnects on connection loss.
 */
export async function startTunnel(config: TunnelConfig): Promise<TunnelState> {
  if (tunnelSession?.alive) {
    throw new Error(`Tunnel is already running on port ${currentPort}`)
  }

  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }

  const port = await findAvailablePort(config.localPort)
  if (port !== config.localPort) {
    console.warn(
      `[studio-tunnel] Port ${config.localPort} occupied, using port ${port}`,
    )
  }

  currentTunnelConfig = config

  const session = await sshFactory.connect({
    user: config.user,
    host: config.host,
    identityFile: config.identityFile,
  })

  tunnelSession = session
  currentPort = port
  startTime = Date.now()
  lastHeartbeatValue = Date.now()
  lastErrorValue = null

  localServer = createServer((socket: Socket) => {
    if (!tunnelSession?.alive) {
      socket.destroy(new Error("Tunnel is not connected"))
      return
    }

    tunnelSession.client.forwardOut(
      "127.0.0.1",
      port,
      "127.0.0.1",
      config.remotePort,
      (err, stream) => {
        if (err) {
          lastErrorValue = err.message
          socket.destroy(err)
          return
        }

        socket.pipe(stream)
        stream.pipe(socket)

        stream.on("error", () => socket.end())
        socket.on("error", () => stream.end())
      },
    )
  })

  localServer.listen(port, "127.0.0.1")

  session.client.on("close", () => {
    if (!tunnelSession) return
    tunnelSession.alive = false
    lastErrorValue = "SSH connection closed"

    console.error("[studio-tunnel] SSH connection lost, auto-restart in 10s...")

    restartTimer = setTimeout(() => {
      restartTimer = null
      if (currentTunnelConfig && (!tunnelSession || !tunnelSession.alive)) {
        startTunnel({ ...currentTunnelConfig, localPort: port }).catch((err) => {
          console.error(`[studio-tunnel] Auto-restart failed:`, err.message)
        })
      }
    }, 10_000)
  })

  session.client.on("error", (err: Error) => {
    lastErrorValue = err.message
    console.error(`[studio-tunnel] SSH error:`, err.message)
  })

  startHeartbeat()

  return {
    config: { ...config, localPort: port },
    alive: true,
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    lastError: null,
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)

  heartbeatTimer = setInterval(() => {
    if (!tunnelSession?.alive) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      return
    }

    if (localServer?.listening) {
      lastHeartbeatValue = Date.now()
    } else {
      tunnelSession.alive = false
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }
  }, 15_000)
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

export function stopTunnel(): boolean {
  if (!tunnelSession && !localServer) return false

  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }

  if (localServer) {
    localServer.close()
    localServer = null
  }

  if (tunnelSession) {
    tunnelSession.alive = false
    try {
      tunnelSession.client.end()
    } catch {
      // Session already closed
    }
    tunnelSession = null
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  currentTunnelConfig = null
  currentPort = 0
  startTime = null
  lastErrorValue = null

  return true
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function isTunnelAlive(): boolean {
  return tunnelSession?.alive === true && localServer?.listening === true
}

export function getTunnelState(): TunnelState | null {
  if (!currentTunnelConfig) return null

  return {
    config: { ...currentTunnelConfig, localPort: currentPort },
    alive: tunnelSession?.alive === true && localServer?.listening === true,
    startTime,
    lastHeartbeat: lastHeartbeatValue,
    lastError: lastErrorValue,
  }
}

export function _resetTunnelState(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (localServer) {
    localServer.close()
    localServer = null
  }
  if (tunnelSession) {
    tunnelSession.alive = false
    try {
      tunnelSession.client.end()
    } catch {
      // Session already closed
    }
    tunnelSession = null
  }
  currentTunnelConfig = null
  currentPort = 0
  startTime = null
  lastHeartbeatValue = Date.now()
  lastErrorValue = null
}
