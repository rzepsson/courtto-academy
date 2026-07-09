// Dismisses a single notification. The service guards ownership and the
// dismissible flag, so a system notification returns 404 here rather than being
// removed.
export default defineEventHandler(async (event) => {
  const { userId } = await getActiveScope(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing notification id' })
  }

  const dismissed = await dismissNotification(userId, id)
  if (!dismissed) {
    throw createError({ statusCode: 404, statusMessage: 'Notification not found' })
  }

  return { ok: true }
})
