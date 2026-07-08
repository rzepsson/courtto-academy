// Redeem a school join code. Requires an authenticated user; adds them as a
// `student` (never a privileged role — that path stays behind email invites).
// Idempotent: re-redeeming while already a member is a no-op success.
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const { code } = await readBody<{ code?: string }>(event)

  const target = await resolveJoinCodeTarget(code ?? '')
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Invalid or expired code' })
  }

  if (!(await isOrganizationMember(target.organizationId, session.user.id))) {
    // Server-only Better Auth API: adds the membership without an invitation and
    // without requiring the caller to be an org admin (rule 4 — no direct insert).
    await auth.api.addMember({
      body: {
        userId: session.user.id,
        organizationId: target.organizationId,
        role: 'student'
      }
    })
  }

  return { organization: target.organization }
})
