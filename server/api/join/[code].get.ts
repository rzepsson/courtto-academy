// Public by design: the code is the unguessable token. Returns just the school
// identity so the join page can show "Join {school}" before the user commits.
// Invalid or expired codes are indistinguishable (both 404) to avoid probing.
export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code') ?? ''
  const target = await resolveJoinCodeTarget(code)

  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Invalid or expired code' })
  }

  return { organization: target.organization }
})
