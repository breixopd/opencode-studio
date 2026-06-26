/**
 * Leveled logger — replaces scattered console.* calls with one controllable surface.
 *
 * Levels: debug < info < warn < error
 *
 * Set STUDIO_LOG_LEVEL=error to silence everything but errors.
 * Set STUDIO_LOG_LEVEL=debug for verbose output.
 * Default: info (shows operational messages like "auto-sync started").
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function currentLevel(): LogLevel {
  const env = process.env.STUDIO_LOG_LEVEL?.toLowerCase()
  if (env && env in LEVEL_ORDER) return env as LogLevel
  return "info"
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel()]
}

/** Debug — verbose, usually suppressed. */
export function debug(msg: string, ...args: unknown[]): void {
  if (shouldLog("debug")) console.log(`[studio] ${msg}`, ...args)
}

/** Info — operational messages ("auto-sync started", "pruned 5 cost events"). */
export function info(msg: string, ...args: unknown[]): void {
  if (shouldLog("info")) console.log(`[studio] ${msg}`, ...args)
}

/** Warn — recoverable issues ("tunnel reconnect failed", "no test file for task"). */
export function warn(msg: string, ...args: unknown[]): void {
  if (shouldLog("warn")) console.warn(`[studio] ${msg}`, ...args)
}

/** Error — failures that need attention ("SSH connection lost", "sync error"). */
export function error(msg: string, ...args: unknown[]): void {
  if (shouldLog("error")) console.error(`[studio] ${msg}`, ...args)
}
