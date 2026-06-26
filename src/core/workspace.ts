/**
 * Workspace state — barrel re-export of all workspace domain modules.
 *
 * Modules are split by domain for maintainability:
 *   workspace-base     — shared infrastructure, helpers, row types, mappers, loadWorkspace
 *   workspace-plans     — plan CRUD, activation, revision, export
 *   workspace-tasks     — task board CRUD with branch-aware filtering
 *   workspace-branches  — context-folding sub-goal branches
 *   workspace-handoffs  — structured session summaries
 *   workspace-rules     — project-scoped user rules
 *   workspace-verify    — verify state + grind count + canHandoff
 *   workspace-pins      — pinned context that survives compaction
 *   workspace-memory    — cross-entity memory search
 *   workspace-context   — session context blocks (stable + dynamic)
 *
 * All state lives in `.studio/studio.db` (SQLite). No JSON files.
 */
export {
  loadWorkspace,
  saveWorkspace,
  resetWorkspaceCache,
} from "./workspace-base"

export {
  listPlans,
  getPlan,
  getActivePlan,
  savePlan,
  exportPlanMarkdown,
  activatePlan,
  reviseActivePlan,
  readPlanMarkdown,
  activeArchitectureText,
  getActivePlanId,
  setActivePlanId,
} from "./workspace-plans"

export {
  listTasks,
  getTask,
  incompleteTasks,
  createTask,
  updateTask,
  setActiveTasks,
  getActiveTasks,
  getWorkflowState,
} from "./workspace-tasks"

export {
  openBranch,
  foldBranch,
  listBranches,
  getActiveBranch,
} from "./workspace-branches"

export {
  saveHandoff,
  listHandoffs,
} from "./workspace-base"

export {
  listRules,
  addRule,
  removeRule,
  formatRules,
} from "./workspace-base"

export {
  recordVerifyFailure,
  recordVerifySuccess,
  getVerifyState,
  getVerifyRetryHint,
  canHandoff,
} from "./workspace-verify"

export {
  listPinnedContext,
  pinContext,
  unpinContext,
  clearPinnedContext,
} from "./workspace-base"

export {
  searchMemory,
  type MemoryHit,
} from "./workspace-base"

export {
  rememberRulesText,
  activePlanContextBlock,
  studioPersistentContext,
  studioStableContext,
  studioDynamicContext,
} from "./workspace-context"
