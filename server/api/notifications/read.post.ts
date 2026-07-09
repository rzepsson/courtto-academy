// Marks every unread notification in the caller's scope as read — fired when the
// bell panel is opened, clearing the unread badge.
export default defineEventHandler(async (event) => {
  const { userId, activeOrgId } = await getActiveScope(event)
  await markScopeRead(userId, activeOrgId)
  return { ok: true }
})
