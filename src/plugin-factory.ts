import type { Plugin, ToolDefinition } from "@opencode-ai/plugin"
import { createEventHook } from "./hooks/session-start"
import { createDisciplineSystemHook } from "./hooks/discipline"
import { createConfigInjectHook } from "./hooks/config-inject"
import { createCompressOutputHook } from "./hooks/compress-output"
import { createCompactionHook } from "./hooks/compaction"
import { createChatParamsHook } from "./hooks/chat-params"
import { createCompactionContinueHook } from "./hooks/compaction-continue"
import { createToolGuardsHook } from "./hooks/tool-guards"
import { createChatMessageHook } from "./hooks/chat-message"
import { createShellEnvHook } from "./hooks/shell-env"

/** Hooks registered by the studio plugin (oh-my-style factory). */
export function createStudioHooks(): Record<string, unknown> {
  return {
    config: createConfigInjectHook(),
    "chat.message": createChatMessageHook(),
    "experimental.chat.system.transform": createDisciplineSystemHook(),
    "chat.params": createChatParamsHook(),
    "shell.env": createShellEnvHook(),
    "tool.execute.before": createToolGuardsHook(),
    "tool.execute.after": createCompressOutputHook(),
    "experimental.session.compacting": createCompactionHook(),
    "experimental.compaction.autocontinue": createCompactionContinueHook(),
    event: createEventHook(),
  }
}

/** Full plugin assembly: bind directory, register tools + hooks. */
export async function createStudioPlugin(
  ctx: { directory?: string } | undefined,
  tools: Record<string, ToolDefinition>,
  // Explicit any avoids exporting Zod internals from @opencode-ai/plugin tool types.
): Promise<any> {
  const { setActiveDirectory } = await import("./core/active-dir")
  setActiveDirectory(ctx?.directory)

  return {
    tool: { ...tools },
    ...createStudioHooks(),
  }
}

export function asPlugin(fn: (ctx: { directory?: string }) => Promise<any>): Plugin {
  return fn as unknown as Plugin
}
