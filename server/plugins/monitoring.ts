import { captureError } from '../utils/monitoring'

// Captures every UNHANDLED server error (thrown out of an API handler) through the
// observability seam — the safety net beneath the explicit best-effort captures.
// Expected app errors (validation/auth/not-found, i.e. 4xx `createError`s) are
// normal control flow, not incidents, so only 5xx / uncoded errors are reported —
// otherwise the signal drowns in routine 403s.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    const statusCode = (error as { statusCode?: number }).statusCode
    if (typeof statusCode === 'number' && statusCode < 500) return

    captureError(error, {
      scope: 'unhandled',
      path: event?.path,
      method: event?.method
    })
  })
})
