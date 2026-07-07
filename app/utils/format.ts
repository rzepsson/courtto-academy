// Locale-aware date formatting. Centralized so every list/label formats dates
// the same way and an SSR/client locale fix lands in one place.
export function formatDate(
  value: string | Date,
  locale: string,
  dateStyle: Intl.DateTimeFormatOptions['dateStyle'] = 'medium'
): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle })
}
