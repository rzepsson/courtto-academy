// Clears all dismissible notifications in the caller's scope (the "clear all"
// button). System notifications are left untouched.
export default defineEventHandler(async (event) => {
  const { userId, activeOrgId } = await getActiveScope(event)
  await clearNotifications(userId, activeOrgId)
  return { ok: true }
})
