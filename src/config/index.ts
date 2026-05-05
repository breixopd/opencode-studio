export type { StudioConfig, ProjectMapping, SSHConfig, TunnelConfig } from "./types"
export { DEFAULT_CONFIG, DEFAULT_EXCLUDES } from "./defaults"
export {
  StudioConfigSchema,
  ProjectMappingSchema,
  SSHConfigSchema,
  TunnelConfigSchema,
  validateConfig,
  safeValidateConfig,
} from "./schema"
export type { ValidatedStudioConfig } from "./schema"
export {
  loadConfig,
  saveConfig,
  addProject,
  removeProject,
  listProjects,
  getConfigPath,
  getConfigDir,
} from "./config"
