import { z } from 'zod'

// Display + form helpers for the account page. Pure and framework-free so the
// policies are unit-testable, mirroring app/utils/schedule.ts.
//
// The validation schemas live here rather than in shared/ on purpose: unlike the
// org-profile / courts / member-profile schemas, there is no app-owned server
// endpoint to keep in step — the server end of these three forms is Better Auth's
// own route validation. A shared schema would be half-used, so this stays what it
// is: client-side form rules, with the server as the authority.

// Better Auth's own default minimum (emailAndPassword.minPasswordLength); it
// rejects anything shorter, so the form matches rather than guessing looser.
export const MIN_PASSWORD_LENGTH = 8

// Localized schemas bound to each card's `UForm :schema`. Rebuilt per locale (call
// inside a computed) so messages follow the UI language.
export function accountFormSchemas(t: (key: string) => string) {
  return {
    profile: z.object({
      name: z.string().trim().min(1, t('account.errors.nameRequired')).max(100, t('account.errors.tooLong'))
    }),
    email: z.object({
      email: z.string().trim().pipe(z.email(t('account.errors.emailInvalid')))
    }),
    password: z
      .object({
        currentPassword: z.string().min(1, t('account.errors.currentPasswordRequired')),
        newPassword: z.string().min(MIN_PASSWORD_LENGTH, t('account.errors.passwordTooShort')),
        confirmPassword: z.string()
      })
      .refine(state => state.newPassword === state.confirmPassword, {
        message: t('account.errors.passwordMismatch'),
        path: ['confirmPassword']
      })
  }
}

export interface DeviceDescription {
  browser: string | null
  os: string | null
}

// Order matters: the more specific token wins. Edge and modern Chromium browsers
// all carry "Chrome" in their UA, and Safari's string contains "Safari" for every
// Chromium browser too — so the impostors are checked before the originals.
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bBrave\//, 'Brave'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari']
]

// Checked before Android/Linux: an Android UA also says "Linux", and iPadOS
// reports itself as "Macintosh" unless "Mobile" gives it away.
const OPERATING_SYSTEMS: [RegExp, string][] = [
  [/\bWindows NT\b/, 'Windows'],
  [/\bAndroid\b/, 'Android'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux']
]

function matchFirst(value: string, table: [RegExp, string][]): string | null {
  return table.find(([pattern]) => pattern.test(value))?.[1] ?? null
}

// Best-effort browser/OS from a user-agent string. Deliberately coarse: this
// labels a row in "your devices" so someone can recognise a session they don't
// remember — it is not analytics, and an unrecognised agent degrades to nulls
// (the UI then shows a generic "Unknown device") rather than a raw UA dump.
export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  if (!userAgent) {
    return { browser: null, os: null }
  }

  return {
    browser: matchFirst(userAgent, BROWSERS),
    os: matchFirst(userAgent, OPERATING_SYSTEMS)
  }
}

// "Chrome · Windows", or whichever half could be identified. Null when neither
// could, so the caller substitutes localized fallback copy (rule 5 — this helper
// never invents user-facing text).
export function formatDeviceLabel(userAgent: string | null | undefined): string | null {
  const { browser, os } = describeUserAgent(userAgent)
  const parts = [browser, os].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}
