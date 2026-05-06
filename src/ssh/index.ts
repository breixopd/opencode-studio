export { createSession, execCommand, uploadFile, closeSession } from "./manager"
export { detectRemoteShell } from "./shell"
export type { SSHSession, SSHSessionConfig } from "./types"
export {
  sshFactory,
  setSSHFactory,
  resetSSHFactory,
  SSHClientFactory,
  RealSSHClientFactory,
} from "./factory"
