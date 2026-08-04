import { AREA_ROLES } from '../../../../../../shared/permissions'

// Cancel a student's subscription — at period end by default (they keep the spot
// until the paid month ends), or `{ immediately: true }` to stop now. School roles;
// a POST, so the subscription gate applies. Returns the mirrored billing state.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)

  const enrollmentId = getRouterParam(event, 'id')
  if (!enrollmentId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing enrolment id' })
  }

  const body = await readBody(event).catch(() => ({}))
  const billing = await cancelEnrollmentSubscription(
    membership.organization.id,
    enrollmentId,
    { immediately: body?.immediately === true },
    { memberId: membership.id, name: session.user.name }
  )
  return { billing }
})
