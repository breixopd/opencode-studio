import type { Plugin } from "@opencode-ai/plugin"
import { studio_sync_start, studio_sync_stop } from "./tools/sync"
import { studio_tunnel_status, studio_tunnel_restart } from "./tools/tunnel"
import { studio_add_project, studio_remove_project } from "./tools/config"
import { studio_status, studio_list_projects } from "./tools/status"
import { studio_setup } from "./tools/setup"
import { studio_doctor } from "./tools/doctor"
import { studio_search } from "./tools/search-tool"
import { studio_retrieve } from "./tools/retrieve"
import { studio_task } from "./tools/tasks"
import { studio_plan } from "./tools/plan"
import { studio_handoff } from "./tools/handoff"
import { studio_diagram } from "./tools/diagram"
import { studio_verify } from "./tools/verify"
import { studio_fetch } from "./tools/fetch"
import { studio_code_search } from "./tools/code-search"
import { studio_preferences } from "./tools/preferences"
import { studio_remember } from "./tools/remember"
import { createChatMessageHook } from "./hooks/rule-reminders"
import { createEventHook } from "./hooks/session-start"
import { createDisciplineSystemHook } from "./hooks/discipline"
import { createOrchestrationHook } from "./hooks/orchestration"
import { createConfigInjectHook } from "./hooks/config-inject"
import { createCompressOutputHook } from "./hooks/compress-output"
import { createCompactionHook } from "./hooks/compaction"

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
      studio_doctor,
      studio_search,
      studio_retrieve,
      studio_task,
      studio_plan,
      studio_handoff,
      studio_diagram,
      studio_verify,
      studio_fetch,
      studio_code_search,
      studio_preferences,
      studio_remember,
    },
    config: createConfigInjectHook(),
    "chat.message": async (input, output) => {
      await createChatMessageHook()(input, output)
      await createOrchestrationHook()(input, output)
    },
    "experimental.chat.system.transform": createDisciplineSystemHook(),
    "tool.execute.after": createCompressOutputHook(),
    "experimental.session.compacting": createCompactionHook(),
    event: createEventHook(),
  }
}

export default OpenCodeStudio
