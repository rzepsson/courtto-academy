import { sql } from 'drizzle-orm'
import { db } from '../db'

// A cheap liveness probe for the database dependency — one round trip, no tables.
// Returns false rather than throwing so the health handler can answer 503 with a
// clean body instead of a stack trace.
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}
