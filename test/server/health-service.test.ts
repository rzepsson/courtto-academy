import { describe, expect, it } from 'vitest'
import { checkDatabaseHealth } from '../../server/utils/services/health'
import { hasTestDb } from './helpers'

// Confirms the readiness probe's DB round trip actually executes against a real
// Postgres (postgres-js), not just that it type-checks.
describe.skipIf(!hasTestDb)('health service', () => {
  it('reports the database as reachable', async () => {
    expect(await checkDatabaseHealth()).toBe(true)
  })
})
