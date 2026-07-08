/**
 * Pure helpers for turning errors from Better Auth client calls and internal
 * `/api/*` fetches into a localized message key. Kept framework-free so the
 * message-selection policy is unit-testable without a live i18n instance; the
 * `useApiError` composable is the thin runtime wrapper around them.
 */

export interface NormalizedError {
  code: string | null
  status: number | undefined
}

function readProp(source: object, key: string): unknown {
  return (source as Record<string, unknown>)[key]
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/**
 * Extract the stable machine code and HTTP status from either shape we see:
 * a Better Auth error (`{ code, status }`) or an ofetch `FetchError`
 * (`{ statusCode, data: { code } }`).
 */
export function normalizeError(error: unknown): NormalizedError {
  if (!error || typeof error !== 'object') {
    return { code: null, status: undefined }
  }

  const data = readProp(error, 'data')
  const dataCode = data && typeof data === 'object' ? asString(readProp(data, 'code')) : null

  return {
    code: asString(readProp(error, 'code')) ?? dataCode,
    status: asNumber(readProp(error, 'status')) ?? asNumber(readProp(error, 'statusCode'))
  }
}

/**
 * Resolve the i18n key for a user-facing error. `hasKey` reports whether a
 * translation exists (i18n's `te`), so a known code maps to `error.codes.*`
 * and everything else degrades to a status-specific or generic message —
 * raw untranslated server text is never surfaced.
 */
export function resolveErrorKey(error: unknown, hasKey: (key: string) => boolean): string {
  const { code, status } = normalizeError(error)

  if (code) {
    const key = `error.codes.${code}`
    if (hasKey(key)) return key
  }

  if (status === 429) return 'error.rateLimited'
  if (status === 0) return 'error.network'

  return 'error.generic.description'
}
