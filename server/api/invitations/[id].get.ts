// Public by design: the invitation id is an unguessable token acting as the
// invite link. The recipient's email is masked in the service layer.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing invitation id' })
  }

  const landing = await getInvitationLanding(id)

  if (!landing) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }

  return landing
})
