// Locale-aware date formatting. Centralized so every list/label formats dates
// the same way and an SSR/client locale fix lands in one place.
export function formatDate(
  value: string | Date,
  locale: string,
  dateStyle: Intl.DateTimeFormatOptions['dateStyle'] = 'medium'
): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle })
}

// Locale-aware "2 hours ago" style formatting for notification timestamps.
// Falls back through the natural time units; anything past a week reads as an
// absolute date so old items stay legible.
export function formatRelativeTime(value: string | Date, locale: string): string {
  const then = new Date(value).getTime()
  const diffSeconds = Math.round((then - Date.now()) / 1000)
  const abs = Math.abs(diffSeconds)

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7]
  ]

  if (abs < 45) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second')
  }

  let unitSeconds = 1
  for (const [unit, factor] of units) {
    const next = unitSeconds * factor
    if (abs < next) {
      return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(diffSeconds / unitSeconds), unit)
    }
    unitSeconds = next
  }

  return formatDate(value, locale, 'medium')
}

// Display-only grouping for join codes: "ABCDEFGH" → "ABCD-EFGH". Purely
// cosmetic — the stored/redeemed value is always the ungrouped code, and the
// server normalizes any dashes back out.
export function formatJoinCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-')
}
