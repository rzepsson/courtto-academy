// Locale-aware date formatting. Centralized so every list/label formats dates
// the same way and an SSR/client locale fix lands in one place.
export function formatDate(
  value: string | Date,
  locale: string,
  dateStyle: Intl.DateTimeFormatOptions['dateStyle'] = 'medium'
): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle })
}

// Display-only grouping for join codes: "ABCDEFGH" → "ABCD-EFGH". Purely
// cosmetic — the stored/redeemed value is always the ungrouped code, and the
// server normalizes any dashes back out.
export function formatJoinCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-')
}
