/**
 * Leveled logger — replaces scattered console.* calls with one controllable surface.
 *
 * Levels: debug < info < warn < error
 *
 * Set STUDIO_LOG_LEVEL=debug for full diagnostic output (shows every SDK event,
 * tool execution, DB query, context block, TUI render, and error).
 * Set STUDIO_LOG_LEVEL=error to silence everything but errors.
 * Default: info (shows operational messages like "auto-sync started").
 *
 * Debug logs are designed for post-session diagnosis — if something didn't work,
 * STUDIO_LOG_LEVEL=debug gives you the complete picture of what happened.
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

/** Debug — verbose diagnostic info. Silenced by default. Use STUDIO_LOG_LEVEL=debug to see. */
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

/**
 * Debug a raw SDK event — logs event type + truncated properties.
 * Used by the session-start event hook to trace what OpenCode actually sends.
 */
export function debugEvent(eventType: string, properties: unknown): void {
  if (!shouldLog("debug")) return
  const propStr = typeof properties === "object" && properties !== null
    ? JSON.stringify(properties).slice(0, 300)
    : String(properties).slice(0, 300)
  console.log(`[studio] event: ${eventType} ${propStr}`)
}

/**
 * Debug a tool execution — logs tool name, args (truncated), and result status.
 */
export function debugTool(toolName: string, detail: string): void {
  if (shouldLog("debug")) console.log(`[studio] tool: ${toolName} — ${detail}`)
}

/**
 * Debug a context block injection — logs which blocks were added to the system prompt.
 */
export function debugContext(blockName: string, length: number): void {
  if (shouldLog("debug")) console.log(`[studio] context: ${blockName} (${length} chars)`)
}

/**
 * Debug a DB operation — logs the SQL + param count.
 */
export function debugDb(operation: string, sql: string, paramCount: number): void {
  if (!shouldLog("debug")) return
  const sqlPreview = sql.replace(/\s+/g, " ").trim().slice(0, 80)
  console.log(`[studio] db: ${operation} [${paramCount} params] ${sqlPreview}`)
}

/**
 * Debug a TUI operation — logs what the TUI plugin is doing.
 */
export function debugTui(operation: string, detail: string): void {
  if (shouldLog("debug")) console.log(`[studio] tui: ${operation} — ${detail}`)
}

/**
 * Debug a catch block — logs what was swallowed and why.
 * Replaces silent `} catch { /* best-effort *\/ }` with visible diagnostics.
 */
export function debugCatch(context: string, err: unknown): void {
  if (!shouldLog("debug")) return
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`[studio] catch: ${context} — ${msg.slice(0, 150)}`)
}
