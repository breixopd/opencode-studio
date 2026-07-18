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
import {
  getPendingCatalogNotice,
  getPreferLocalModels,
  hasExplicitBudget,
} from "../core/project-profile"
import { getSemanticRecallStatus } from "../core/semantic-recall"
import { getActiveDirectory } from "../core/active-dir"
import { probeOllama } from "./setup"
import { resolveGitHubAuth } from "../core/github-auth"

/** Checks that may be not-ok without failing overall health (progressive disclosure). */
const WARN_ONLY = new Set(["tunnel", "tasks", "verify_gate", "ollama", "onboard", "sync", "github_auth"])

type Check = { name: string; ok: boolean; detail: string; advisory?: boolean }

function formatDoctorReport(healthy: boolean, checks: Check[]): string {
  const pass: Check[] = []
  const warn: Check[] = []
  const fail: Check[] = []

  for (const c of checks) {
    if (c.advisory || (!c.ok && WARN_ONLY.has(c.name))) {
      warn.push(c)
    } else if (!c.ok) {
      fail.push(c)
    } else {
      pass.push(c)
    }
  }

  const lines = [
    "# studio_doctor",
    "",
    `**${healthy ? "Healthy" : "Unhealthy"}** — Pass: ${pass.length} · Warn: ${warn.length} · Fail: ${fail.length}`,
    "",
  ]

  if (fail.length > 0) {
    lines.push(`## Fail (${fail.length})`)
    for (const c of fail) lines.push(`✗ **${c.name}** — ${c.detail}`)
    lines.push("")
  }

  if (warn.length > 0) {
    lines.push(`## Warn (${warn.length})`)
    for (const c of warn) lines.push(`⚠ **${c.name}** — ${c.detail}`)
    lines.push("")
  }

  if (pass.length > 0) {
    lines.push(`## Pass (${pass.length})`)
    for (const c of pass) lines.push(`✓ **${c.name}** — ${c.detail}`)
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

export const studio_doctor: ToolDefinition = tool({
  description: "Health check: config, SSH, tunnel, sync, code index, model routing, semantic recall, Ollama.",
  args: {},
  async execute() {
    const checks: Check[] = []

    let config
    try {
      config = ensureStudioReady()
      checks.push({ name: "config", ok: true, detail: "Auto-configured" })
    } catch (err) {
      checks.push({ name: "config", ok: false, detail: (err as Error).message })
      return formatDoctorReport(false, checks)
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

    const ghAuth = await resolveGitHubAuth()
    checks.push({
      name: "github_auth",
      ok: !!ghAuth.token,
      detail: ghAuth.token
        ? ghAuth.source === "gh"
          ? "ok via `gh auth` — studio_code_search / studio_git remotes / studio_ci"
          : `ok via ${ghAuth.source}`
        : "not signed in — `gh auth login` or set GITHUB_TOKEN/GH_TOKEN (code search + git push/PR)",
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

    const cwd = getActiveDirectory()
    const recallStatus = getSemanticRecallStatus(cwd)
    checks.push({
      name: "semantic_recall",
      ok: true,
      detail:
        recallStatus === "off"
          ? "off (default) — studio_preferences set_semantic_recall true"
          : recallStatus === "vec"
            ? "on — sqlite-vec loaded"
            : "on — FTS token-overlap fallback (sqlite-vec not loaded)",
    })

    const ollamaOk = await probeOllama(400)
    checks.push({
      name: "ollama",
      ok: ollamaOk,
      detail: ollamaOk
        ? "reachable on :11434"
        : "not reachable on :11434 (optional — start Ollama or LM Studio)",
    })

    if (ollamaOk && (!hasExplicitBudget() || !getPreferLocalModels())) {
      checks.push({
        name: "onboard",
        ok: true,
        advisory: true,
        detail:
          "Ollama reachable — run studio_setup({ action: \"onboard\" }) to lock $5 budget + prefer_local",
      })
    }

    const catalogNotice = getPendingCatalogNotice()
    const registry = loadModelRegistry()
    checks.push({
      name: "model_catalog",
      ok: !catalogNotice,
      detail: catalogNotice ?? `zen=${registry.zen.ids.length} providers=${registry.providersFingerprint || "unsynced"}`,
    })

    const healthy = checks
      .filter((c) => !WARN_ONLY.has(c.name) || c.ok)
      .every((c) => c.ok)

    return formatDoctorReport(healthy, checks)
  },
})
