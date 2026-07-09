import { deriveRegionalDefaults } from '~~/shared/regional'

export { deriveRegionalDefaults }
export type { RegionalDefaults } from '~~/shared/regional'

// Reads the browser's zero-permission regional signals: the resolved IANA time
// zone and the preferred language. Client-only — on the server `Intl` would
// report the server's zone, so only call this from a user interaction (e.g. the
// create-school click handler), never during SSR setup.
export function detectBrowserRegional(): { timezone?: string, language?: string } {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  const language = typeof navigator !== 'undefined' ? navigator.language || undefined : undefined
  return { timezone, language }
}
