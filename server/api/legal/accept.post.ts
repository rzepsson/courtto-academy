// Re-accept the current documents after a version bump. Sign-up records the first
// acceptance server-side (see the user-create hook in auth.ts); this is the path
// for an existing account whose accepted version has since moved on.
//
// The body carries no version: what a client claims it read is not evidence. The
// service always records the versions the server is currently serving.
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)

  await recordLegalAcceptance({
    userId: session.user.id,
    ipAddress: getRequestIP(event, { xForwardedFor: true }) ?? null,
    userAgent: getRequestHeader(event, 'user-agent') ?? null
  })

  return await getUserLegalState(session.user.id)
})
