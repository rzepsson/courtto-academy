import type { H3Event } from 'h3'

export function getUserSession(event: H3Event) {
  return auth.api.getSession({ headers: event.headers })
}

export async function requireUserSession(event: H3Event) {
  const session = await getUserSession(event)

  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  return session
}
