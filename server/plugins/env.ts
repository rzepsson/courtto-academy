import { env } from 'node:process'

// Fail fast at server startup if any required secret is missing, with one clear
// message — better than a cryptic Better Auth/Drizzle error on the first request.
const REQUIRED = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'] as const

export default defineNitroPlugin(() => {
  const missing = REQUIRED.filter(key => !env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
})
