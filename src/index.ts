import type { Plugin } from "@opencode-ai/plugin"
import { studio_sync_start, studio_sync_stop } from "./tools/sync"
import { studio_tunnel_status, studio_tunnel_restart } from "./tools/tunnel"
import { studio_add_project, studio_remove_project } from "./tools/config"
import { studio_status, studio_list_projects } from "./tools/status"
import { studio_setup } from "./tools/setup"

export const OpenCodeStudio: Plugin = async () => {
  return {
    tool: {
      studio_sync_start,
      studio_sync_stop,
      studio_tunnel_status,
      studio_tunnel_restart,
      studio_add_project,
      studio_remove_project,
      studio_status,
      studio_list_projects,
      studio_setup,
    },
  }
}

export default OpenCodeStudio
