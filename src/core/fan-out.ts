/**
 * Parallel fan-out — spawns read-only subagents concurrently via the
 * /start-work command template.
 *
 * The opencode SDK dispatches @studio-* mentions as subtasks. By instructing
 * the agent to invoke multiple read-only subagents in one message, they run
 * concurrently rather than sequentially.
 *
 * This module provides:
 *   - The fan-out template for /start-work (injected into config-inject.ts)
 *   - A studio_fanout tool that the agent can call to dispatch specific agents
 *   - A heuristic for deciding whether fan-out is warranted (>3 plan steps)
 */

export interface FanOutPlan {
  agents: Array<{ name: string; task: string; reason: string }>
  parallel: boolean
  reason: string
}

/** Decide which agents to fan out based on the plan/goal complexity. */
export function planFanOut(goal: string, planSteps: number): FanOutPlan {
  const goalLower = goal.toLowerCase()

  // Only fan out for non-trivial work.
  if (planSteps <= 3 && !goalLower.match(/auth|security|api|database|migration|performance/)) {
    return {
      agents: [{ name: "@studio-explore", task: `Explore the codebase to understand how ${goal} should be implemented`, reason: "Small scope — explore only" }],
      parallel: false,
      reason: "Trivial scope — sequential explore → implement is sufficient",
    }
  }

  const agents: FanOutPlan["agents"] = [
    { name: "@studio-explore", task: `Explore the codebase to understand the architecture, existing patterns, and where ${goal} should be implemented. Report: file structure, relevant modules, existing conventions.`, reason: "Understanding the codebase first" },
  ]

  // Security for auth/data/API work.
  if (goalLower.match(/auth|login|session|token|password|secret|api|endpoint|payment/)) {
    agents.push({ name: "@studio-security", task: `Security review for ${goal}: identify potential OWASP risks, injection vectors, authn/z flaws, and data exposure points BEFORE implementation begins.`, reason: "Security-sensitive work detected" })
  }

  // Architecture for complex/structural changes.
  if (planSteps > 3 || goalLower.match(/refactor|architecture|migration|database|schema|performance/)) {
    agents.push({ name: "@studio-architect", task: `Architecture review for ${goal}: validate design approach, data flow, module boundaries, and trade-offs BEFORE implementation. Use studio_index to check existing structure.`, reason: "Complex/structural change detected" })
  }

  return {
    agents,
    parallel: true,
    reason: `Fan-out: ${agents.length} read-only agents will run concurrently, then synthesize before planning`,
  }
}

/** Build the fan-out instruction text for the /start-work template. */
export function fanOutInstruction(goal: string, planSteps: number): string {
  const plan = planFanOut(goal, planSteps)
  if (!plan.parallel) {
    return `Explore: @studio-explore — ${plan.agents[0]!.task}`
  }

  const lines = [
    `Concurrent fan-out (${plan.agents.length} agents — run IN ONE MESSAGE so they dispatch in parallel):`,
  ]
  for (const agent of plan.agents) {
    lines.push(`${agent.name} — ${agent.task}`)
  }
  lines.push("")
  lines.push("Wait for ALL agents to complete, then synthesize their findings before proceeding to studio_plan.")
  return lines.join("\n")
}
