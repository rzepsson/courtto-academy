// A machine-readable copy of the caller's own account data (RODO art. 15/20),
// downloaded as JSON. Scoped to the session's user id — there is deliberately no
// id parameter, so this route can only ever return the caller's own data.
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const data = await exportAccountData(session.user.id)

  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  const stamp = new Date().toISOString().slice(0, 10)
  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="courtto-account-${stamp}.json"`)
  return data
})
