import * as log from "../core/logger"
import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { Config } from "@opencode-ai/plugin"
import { execFileSync } from "child_process"
import { existsSync } from "fs"
import { ensureStudioReady } from "../core/auto"
import { parseSSHConfig } from "../config/ssh-config"
import { isTunnelAlive, getTunnelState } from "../tunnel/manager"
import { getActiveSyncProjects } from "../sync/active"
import { collectStudioRuntime } from "../core/studio-runtime"
import { describeRoutingForProvider } from "../core/model-routing"
import { loadModelRegistry } from "../core/model-registry"
import { getPendingCatalogNotice } from "../core/project-profile"
import { getActiveDirectory } from "../core/active-dir"

export const studio_doctor: ToolDefinition = tool({
  description: "Health check: config, SSH, tunnel, sync, code index, model routing.",
  args: {},
  async execute() {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = []

    let config
    try {
      config = ensureStudioReady()
      checks.push({ name: "config", ok: true, detail: "Auto-configured" })
    } catch (err) {
      checks.push({ name: "config", ok: false, detail: (err as Error).message })
      return JSON.stringify({ healthy: false, checks }, null, 2)
    }

    const runtime = collectStudioRuntime({
      tunnelAlive: isTunnelAlive,
      tunnelState: getTunnelState,
      activeSyncs: getActiveSyncProjects,
    })

    const sshReady = runtime.ssh.configured
    const sshHosts = parseSSHConfig()
    checks.push({
      name: "ssh",
      ok: sshReady,
      detail: sshReady
        ? `${config.ssh.user}@${config.ssh.host}`
        : sshHosts.length > 0
          ? `Not bound — candidates: ${sshHosts.map((h) => h.alias).join(", ")}. Run studio_setup({ host })`
          : "Add ~/.ssh/config hosts, then studio_setup({ host })",
    })

    if (sshReady) {
      checks.push({
        name: "ssh_key",
        ok: existsSync(config.ssh.identityFile),
        detail: config.ssh.identityFile,
      })
    }

    checks.push({
      name: "ssh_hosts",
      ok: sshHosts.length > 0,
      detail: `${sshHosts.length} hosts`,
    })

    checks.push({
      name: "tunnel",
      ok: runtime.tunnel.status === "running",
      detail:
        runtime.tunnel.status === "running"
          ? `port ${runtime.tunnel.port}`
          : "auto-starts on session",
    })

    checks.push({
      name: "projects",
      ok: runtime.projectCount > 0,
      detail: `${runtime.projectCount} mapped`,
    })

    checks.push({
      name: "sync",
      ok: true,
      detail: runtime.activeSyncs.length ? runtime.activeSyncs.join(", ") : "auto on session",
    })

    checks.push({
      name: "tasks",
      ok: runtime.openTasks === 0,
      detail: runtime.openTasks ? `${runtime.openTasks} open` : "all complete",
    })

    checks.push({
      name: "verify_gate",
      ok: runtime.verifyPassed === true,
      detail:
        runtime.verifyPassed === true
          ? "passed"
          : runtime.verifyPassed === false
            ? "failed — fix and re-run studio_verify"
            : "not run yet",
    })

    checks.push({
      name: "model_routing",
      ok: true,
      detail: describeRoutingForProvider(config as Config),
    })

    let rgOk = false
    try {
      execFileSync("rg", ["--version"], { stdio: "ignore" })
      rgOk = true
    } catch (err) {
      log.debugCatch("src/tools/doctor.ts", err);
      /* rg optional */
    }
    checks.push({
      name: "ripgrep",
      ok: rgOk,
      detail: rgOk ? "studio_grep ready" : "install rg for local code search",
    })

    // Real SQLite code-index health check (not just "is rg installed").
    let indexStats: { fileCount: number; symbolCount: number; builtAt: string | null } | null = null
    try {
      const { getStats } = await import("../core/code-store")
      indexStats = getStats(getActiveDirectory())
    } catch (err) {
      log.debugCatch("src/tools/doctor.ts", err);
      /* db not openable */
    }
    const indexOk = !!indexStats && indexStats.fileCount > 0
    checks.push({
      name: "code_index",
      ok: indexOk,
      detail: indexOk
        ? `${indexStats!.fileCount} files, ${indexStats!.symbolCount} symbols (built ${indexStats!.builtAt ?? "?"})`
        : rgOk
          ? "rg ready; run studio_index to build AST index"
          : "install rg; AST index still works for symbols",
    })

    const catalogNotice = getPendingCatalogNotice()
    const registry = loadModelRegistry()
    checks.push({
      name: "model_catalog",
      ok: !catalogNotice,
      detail: catalogNotice ?? `zen=${registry.zen.ids.length} providers=${registry.providersFingerprint || "unsynced"}`,
    })

    const healthy = checks
      .filter((c) => !["tunnel", "tasks", "verify_gate"].includes(c.name) || c.ok)
      .every((c) => c.ok)

    return JSON.stringify({ healthy, runtime, checks }, null, 2)
  },
})
