// ─────────────────────────────────────────────────────────────────────────────
// src/utils/logger.ts — Simple structured logger
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

const LEVEL_COLORS: Record<LogLevel, string> = {
  info:  '\x1b[36m',  // cyan
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
  debug: '\x1b[90m',  // grey
}
const RESET = '\x1b[0m'

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const isDev = process.env.NODE_ENV !== 'production'
  const timestamp = new Date().toISOString()
  const color = isDev ? LEVEL_COLORS[level] : ''
  const reset = isDev ? RESET : ''

  const prefix = `${color}[${level.toUpperCase()}]${reset} ${timestamp}`
  const metaStr = meta ? ' ' + JSON.stringify(meta) : ''

  console[level === 'debug' ? 'log' : level](`${prefix} ${message}${metaStr}`)
}

export const logger = {
  info:  (msg: string, meta?: Record<string, unknown>) => log('info',  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => log('warn',  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
}
