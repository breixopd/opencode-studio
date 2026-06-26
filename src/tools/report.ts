import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { ensureStudioReady } from "../core/auto"
import { collectStudioRuntime } from "../core/studio-runtime"
import { isTunnelAlive, getTunnelState } from "../tunnel/manager"
import { getActiveSyncProjects } from "../sync/active"
import { describeRoutingForProvider, getLastRoutedModels } from "../core/model-routing"
import { getLastMainModel } from "../core/session-model"
import { listExhaustedModels } from "../core/model-fallback"
import { getModelMode } from "../core/project-profile"
import {
  getVerifyState,
  getVerifyRetryHint,
  listPinnedContext,
  listRules,
  incompleteTasks,
  getActivePlan,
  listTasks,
  listHandoffs,
  loadWorkspace,
} from "../core/workspace"
import { loadProjectProfile } from "../core/project-profile"

export const studio_report: ToolDefinition = tool({
  description:
    "One-shot smoke-test bundle: status, routing, verify gate, workspace, brief. Paste output to share test results.",
  args: {
    include_workspace: tool.schema
      .boolean()
      .optional()
      .describe("Include full workspace state from studio.db (default false)"),
  },
  async execute(args) {
    ensureStudioReady()
    const runtime = collectStudioRuntime({
      tunnelAlive: isTunnelAlive,
      tunnelState: getTunnelState,
      activeSyncs: getActiveSyncProjects,
    })

    const agentModels = getLastRoutedModels()

    const plan = getActivePlan()
    const report = {
      generatedAt: new Date().toISOString(),
      cwd: process.cwd(),
      runtime,
      routing: {
        modelMode: getModelMode(),
        uiSelectedMain: getLastMainModel() ?? null,
        exhaustedModels: listExhaustedModels(),
        summary: describeRoutingForProvider({ model: getLastMainModel() }),
        subagentModels: agentModels,
      },
      verify: {
        state: getVerifyState() ?? null,
        retryHint: getVerifyRetryHint() ?? null,
      },
      workspace: {
        openTasks: incompleteTasks().map((t) => ({ id: t.id, title: t.title, status: t.status })),
        taskCount: listTasks().length,
        handoffCount: listHandoffs().length,
        rules: listRules(),
        pinnedContext: listPinnedContext(),
        activePlan: plan ? { id: plan.id, title: plan.title, steps: plan.steps.length } : null,
      },
      brief: (() => {
        const p = loadProjectProfile()
        return { name: p.name, summary: p.summary, stack: p.stack }
      })(),
      workspaceJson: args.include_workspace ? loadWorkspace() : undefined,
    }

    return JSON.stringify(report, null, 2)
  },
})
