import type { Plugin, ToolDefinition } from "@opencode-ai/plugin"
import { studio_sync_start, studio_sync_stop } from "./tools/sync"
import { studio_tunnel_status, studio_tunnel_restart } from "./tools/tunnel"
import { studio_add_project, studio_remove_project } from "./tools/config"
import { studio_status, studio_list_projects } from "./tools/status"
import { studio_setup } from "./tools/setup"
import { studio_doctor } from "./tools/doctor"
import { studio_search } from "./tools/search"
import { studio_retrieve } from "./tools/retrieve"
import { studio_task } from "./tools/tasks"
import { studio_plan } from "./tools/plan"
import { studio_handoff } from "./tools/handoff"
import { studio_verify } from "./tools/verify"
import { studio_fetch } from "./tools/fetch"
import { studio_code_search } from "./tools/code-search"
import { studio_grep } from "./tools/grep"
import { studio_glob } from "./tools/glob"
import { studio_symbols } from "./tools/symbols"
import { studio_index } from "./tools/studio-index"
import { studio_crawl } from "./tools/crawl"
import { studio_models } from "./tools/models"
import { studio_preferences } from "./tools/preferences"
import { studio_remember } from "./tools/remember"
import { studio_branch } from "./tools/branch"
import { studio_memory } from "./tools/memory"
import { studio_brief } from "./tools/brief"
import { studio_context } from "./tools/context"
import { studio_report } from "./tools/report"
import { studio_help } from "./tools/help"
import { studio_cost } from "./tools/cost"
import { studio_remote } from "./tools/remote"
import { studio_git } from "./tools/git"
import { studio_spec } from "./tools/spec"
import { studio_refactor } from "./tools/refactor"
import { studio_deps } from "./tools/deps"
import { studio_constitution } from "./tools/constitution"
import { studio_ci } from "./tools/ci"
import { studio_agent } from "./tools/agent"
import { studio_council } from "./tools/council"
import { studio_browser } from "./tools/browser"
import { studio_scout } from "./tools/scout"
import { createStudioPlugin, asPlugin } from "./plugin-factory"

/** Tools registered on the plugin — must stay in sync with ALL_TOOL_NAMES. */
export const REGISTERED_TOOLS: Record<string, ToolDefinition> = {
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
  studio_verify,
  studio_fetch,
  studio_code_search,
  studio_grep,
  studio_glob,
  studio_symbols,
  studio_index,
  studio_crawl,
  studio_models,
  studio_preferences,
  studio_remember,
  studio_branch,
  studio_memory,
  studio_brief,
  studio_context,
  studio_report,
  studio_help,
  studio_cost,
  studio_remote,
  studio_git,
  studio_spec,
  studio_refactor,
  studio_deps,
  studio_constitution,
  studio_ci,
  studio_agent,
  studio_council,
  studio_browser,
  studio_scout,
}

export const OpenCodeStudio: Plugin = asPlugin(async (ctx) => createStudioPlugin(ctx, REGISTERED_TOOLS))

export default OpenCodeStudio
export { createStudioHooks, createStudioPlugin, asPlugin } from "./plugin-factory"
