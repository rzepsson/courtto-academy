import { env } from 'node:process'

// The observability seam: one place every server-side error/incident is reported,
// so the best-effort paths that used to `console.error` into the void become
// structured, shippable events. Mirrors mailer.ts / storage.ts — a module-level
// lazy singleton, env read via node:process, no useRuntimeConfig and no factories
// (rule 2), provider-swappable by env alone. Explicit imports only: this is
// reachable from server/utils/auth.ts, which the `auth` CLI loads outside Nuxt.
//
//   OBSERVABILITY_WEBHOOK_URL   optional. When set, each event is also POSTed as
//                               JSON (fire-and-forget) — point it at a log drain, a
//                               Slack incoming webhook, or a function that forwards
//                               to Sentry/Datadog. Adding a real vendor SDK later is
//                               a one-file swap of the default sink.
//
// Unset -> structured JSON to the server log only (loud, never silent). Reporting
// must NEVER throw or block: an observability failure that cascaded into the code
// it observes would be worse than the incident it records.

export type MonitoringLevel = 'error' | 'warning' | 'info'

export interface MonitoringEvent {
  level: MonitoringLevel
  message: string
  timestamp: string
  error?: { name: string, message: string, stack?: string }
  context?: Record<string, unknown>
}

export interface MonitoringSink {
  readonly name: string
  capture(event: MonitoringEvent): void | Promise<void>
}

// Normalize anything thrown into a serializable shape. A raw Error isn't
// JSON-stringifiable (name/message/stack are non-enumerable), and callers throw
// strings and objects too.
function describeError(error: unknown): { name: string, message: string, stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { name: 'NonError', message: typeof error === 'string' ? error : safeStringify(error) }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// Fires the configured webhook without ever blocking or throwing on the caller's
// path. Absent global fetch (very old runtimes) is simply a no-op.
function forwardToWebhook(event: MonitoringEvent): void {
  const url = env.OBSERVABILITY_WEBHOOK_URL
  if (!url || typeof fetch !== 'function') return
  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: safeStringify(event)
  }).catch(() => {})
}

// The default sink: a structured JSON line to the server log (parseable by any log
// drain) plus the optional webhook. Errors/warnings go to stderr, info to stdout.
class ConsoleSink implements MonitoringSink {
  readonly name = 'console'

  capture(event: MonitoringEvent): void {
    const line = safeStringify({ service: 'courtto', ...event })
    if (event.level === 'info') {
      console.info(line)
    } else {
      console.error(line)
    }
    forwardToWebhook(event)
  }
}

const defaultSink = new ConsoleSink()
let override: MonitoringSink | null = null

function dispatch(event: MonitoringEvent): void {
  const sink = override ?? defaultSink
  try {
    // A sink may be async (webhook); we deliberately don't await — reporting must
    // never delay or fail the caller. A rejected promise is swallowed.
    void Promise.resolve(sink.capture(event)).catch(() => {})
  } catch {
    // A synchronous sink failure must not propagate either.
  }
}

// Report a handled-but-noteworthy failure (a swallowed best-effort error, an
// unhandled request error). `context` should carry safe, structured fields
// (scope, orgId, path) — never secrets or full request bodies.
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  const described = describeError(error)
  dispatch({
    level: 'error',
    message: described.message,
    timestamp: new Date().toISOString(),
    error: described,
    context
  })
}

export function captureMessage(level: MonitoringLevel, message: string, context?: Record<string, unknown>): void {
  dispatch({ level, message, timestamp: new Date().toISOString(), context })
}

// Whether an external sink is configured (for a startup log / health detail).
export function isWebhookConfigured(): boolean {
  return Boolean(env.OBSERVABILITY_WEBHOOK_URL)
}

// Test seam: inject a recording sink, assert on captured events, then clear —
// exactly like mailer.ts's setMailTransport.
export function setMonitoringSink(sink: MonitoringSink): void {
  override = sink
}

export function clearMonitoringSink(): void {
  override = null
}
