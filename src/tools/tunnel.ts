import { tool } from "@opencode-ai/plugin"
import {
  getTunnelState,
  isTunnelAlive,
  stopTunnel,
  startTunnel,
} from "../tunnel/manager"
import { loadConfig } from "../config/config"

export const studio_tunnel_status = tool({
  description:
    "Check the status of the SSH tunnel to the remote development host.",
  args: {},
  async execute() {
    const alive = isTunnelAlive()
    const state = getTunnelState()

    if (!alive || !state) {
      return JSON.stringify({
        status: "stopped",
        message:
          "Tunnel is not running. Use studio_tunnel_restart to start it.",
      })
    }

    const uptime = state.startTime
      ? Math.floor((Date.now() - state.startTime) / 1000)
      : 0

    return JSON.stringify({
      status: "running",
      port: state.config.localPort,
      remotePort: state.config.remotePort,
      host: state.config.host,
      uptimeSeconds: uptime,
      lastError: state.lastError || null,
    })
  },
})

export const studio_tunnel_restart = tool({
  description:
    "Restart the SSH tunnel. Stops any existing tunnel and starts a new one.",
  args: {},
  async execute() {
    const config = loadConfig()

    if (isTunnelAlive()) {
      stopTunnel()
    }

    try {
      const state = await startTunnel({
        user: config.ssh.user,
        host: config.tunnel.host,
        identityFile: config.ssh.identityFile,
        localPort: config.tunnel.localPort,
        remotePort: config.tunnel.remotePort,
      })
      return `Tunnel restarted on port ${state.config.localPort} → ${config.tunnel.host}:${config.tunnel.remotePort}`
    } catch (err) {
      return `Error restarting tunnel: ${(err as Error).message}`
    }
  },
})
