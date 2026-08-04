// Public readiness probe (no auth) for load balancers / container orchestrators.
// 200 when the DB is reachable, 503 when it isn't — the body is deliberately
// minimal so it never leaks internals. Handler stays thin; the DB check is a
// service (rule 1).
export default defineEventHandler(async (event) => {
  const dbUp = await checkDatabaseHealth()

  if (!dbUp) {
    setResponseStatus(event, 503)
    return { status: 'error', db: 'down' }
  }

  return { status: 'ok', db: 'up', time: new Date().toISOString() }
})
