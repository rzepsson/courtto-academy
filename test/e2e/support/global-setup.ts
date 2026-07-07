import { migrateE2eDb } from './db'

// Applies migrations to the disposable e2e database once before the whole run.
export default async function globalSetup() {
  await migrateE2eDb()
}
