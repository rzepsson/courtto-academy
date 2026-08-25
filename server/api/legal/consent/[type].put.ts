import { LEGAL_DOCUMENT_VERSIONS, isAccountConsentType } from '../../../../shared/legal'
import { isConsentDecision } from '../../../../shared/member-consent'

// Record the account holder's own consent decision for one purpose. PUT, not
// PATCH: the request states the decision in full, and re-stating it is idempotent.
//
// Withdrawal asks for nothing and is never questioned — art. 7(3) requires it to
// be as easy as giving consent, so there is no reason field and no confirmation
// step gating it server-side.
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const type = getRouterParam(event, 'type') as string

  if (!isAccountConsentType(type)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown consent type', data: { code: 'CONSENT_TYPE_UNKNOWN' } })
  }

  const body = await readBody<{ status?: unknown }>(event)
  const status = typeof body?.status === 'string' ? body.status : ''

  if (!isConsentDecision(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid decision', data: { code: 'CONSENT_DECISION_INVALID' } })
  }

  await setAccountConsent({
    userId: session.user.id,
    type,
    decision: status,
    // Which wording was agreed to — a changed clause no longer covers an old yes.
    documentVersion: status === 'granted' ? LEGAL_DOCUMENT_VERSIONS.privacy : null
  })

  return await getUserLegalState(session.user.id)
})
