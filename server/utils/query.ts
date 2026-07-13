// Small request-parsing helpers shared by the schedule/court API handlers, so a
// thin handler never re-implements query parsing (auto-imported like db/auth).

// Parse an ISO instant from a query value; null when absent or unparseable.
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
