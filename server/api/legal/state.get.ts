// The account holder's legal state: what they last accepted, whether a document
// has been revised since, and their consent decisions. Account-level (no org
// guard) — it is a property of the login, not of any school, so it stays
// reachable for a suspended membership or a lapsed subscription.
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)

  return await getUserLegalState(session.user.id)
})
