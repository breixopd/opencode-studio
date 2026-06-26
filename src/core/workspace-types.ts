export type TaskStatus = "pending" | "in_progress" | "done" | "blocked"
export type BranchStatus = "open" | "folded"

export interface PlanStep {
  text: string
  done: boolean
}

export interface PlanRevision {
  at: string
  reason: string
  note: string
}

export interface StudioPlan {
  id: string
  title: string
  goal: string
  research: string[]
  architecture: string
  fileStructure: string
  steps: PlanStep[]
  acceptance: string[]
  edgeCases: string
  testStrategy: string
  revisions: PlanRevision[]
  createdAt: string
  updatedAt: string
}

export interface StudioTask {
  id: string
  title: string
  status: TaskStatus
  acceptance?: string[]
  notes?: string
  planId?: string
  createdAt: string
  updatedAt: string
}

export interface StudioHandoff {
  id: string
  summary: string
  filesChanged: string[]
  testsRun?: string
  risks?: string
  nextSteps?: string
  planId?: string
  createdAt: string
}

export interface StudioBranch {
  id: string
  title: string
  goal: string
  status: BranchStatus
  summary?: string
  parentBranchId?: string
  planId?: string
  createdAt: string
  foldedAt?: string
}

export interface VerifyState {
  passed: boolean
  at: string
  commands: string[]
}

export interface VerifyRetryHint {
  count: number
  lastFailure: string
  at: string
}

export interface StudioWorkspace {
  updatedAt: string
  activePlanId?: string
  activeTaskIds: string[]
  activeBranchId?: string
  rules: string[]
  plans: Record<string, StudioPlan>
  tasks: Record<string, StudioTask>
  handoffs: StudioHandoff[]
  branches: Record<string, StudioBranch>
  verify?: VerifyState
  verifyRetryHint?: VerifyRetryHint
  pinnedContext: string[]
}

export function emptyWorkspace(): StudioWorkspace {
  return {
    updatedAt: new Date().toISOString(),
    activeTaskIds: [],
    rules: [],
    plans: {},
    tasks: {},
    handoffs: [],
    branches: {},
    pinnedContext: [],
  }
}
