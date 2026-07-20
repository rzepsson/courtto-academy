import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { memberConsent, memberGuardian } from '../../database/app-schema'
import type { MemberConsentDto } from '../../database/types'
import { CONSENT_TYPES, consentState, isConsentType } from '../../../shared/member-consent'
import type { ConsentType } from '../../../shared/member-consent'
import { consentDecisionSchema } from '../../../shared/member-consent-schema'
import { isMinor } from '../../../shared/member-guardian'
import { getMemberDetail } from './memberProfile'

// Consent records (RODO/GDPR). App-owned CORE; every query scoped by
// organizationId. This service owns the *current* state; the append-only history
// (the art. 7(1) evidence) is written to the audit trail by the handler, which has
// the acting staff member's identity.
//
// Absence of a row = 'unknown' ("never asked"), never 'withdrawn' — see
// CONSENT_STATES for why collapsing the two would be a compliance bug.

const decisionSchema = consentDecisionSchema(code => code)

function bad(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

// Every known purpose, with the member's current decision on each — so the UI can
// show "never asked" as a first-class, chase-able state rather than hiding it.
export async function listMemberConsents(
  organizationId: string,
  memberId: string
): Promise<MemberConsentDto[] | null> {
  const member = await getMemberDetail(organizationId, memberId)
  if (!member) {
    return null
  }

  const rows = await db
    .select()
    .from(memberConsent)
    .where(and(
      eq(memberConsent.organizationId, organizationId),
      eq(memberConsent.memberId, memberId)
    ))

  const byType = new Map(rows.map(row => [row.type, row]))
  const requiresGuardian = isMinor(member.dateOfBirth)

  return CONSENT_TYPES.map((type): MemberConsentDto => {
    const row = byType.get(type) ?? null
    return {
      type,
      state: consentState(row),
      grantedAt: row?.grantedAt ?? null,
      withdrawnAt: row?.withdrawnAt ?? null,
      grantedByName: row?.grantedByName ?? null,
      guardianId: row?.guardianId ?? null,
      documentVersion: row?.documentVersion ?? null,
      notes: row?.notes ?? null,
      requiresGuardian
    }
  })
}

// Record a decision for one purpose. Null when the member isn't this org's.
//
// Who may give it is an age question, resolved here (not in the schema, which
// can't see the stored date of birth): a minor's consent must come from one of
// THEIR guardians; an adult gives it themselves.
export async function recordMemberConsent(
  organizationId: string,
  memberId: string,
  type: string,
  body: unknown,
  recordedByMemberId: string
): Promise<{ consent: MemberConsentDto, granted: boolean, giver: string } | null> {
  if (!isConsentType(type)) {
    bad('Unknown consent type', 'CONSENT_TYPE_UNKNOWN')
  }

  const member = await getMemberDetail(organizationId, memberId)
  if (!member) {
    return null
  }

  const parsed = decisionSchema.safeParse(body)
  if (!parsed.success) {
    bad('Invalid consent', 'INVALID_CONSENT')
  }
  const values = parsed.data
  const granted = values.status === 'granted'

  // Resolve the giver. Only a grant needs one — a withdrawal is honoured whoever
  // relays it (art. 7(3): withdrawal must be as easy as giving, so we never gate
  // it behind paperwork).
  let giverName: string | null = null
  let guardianId: string | null = null

  if (granted) {
    if (isMinor(member.dateOfBirth)) {
      if (!values.guardianId) {
        bad('A minor’s consent must be given by a guardian', 'CONSENT_GUARDIAN_REQUIRED')
      }
      const [guardian] = await db
        .select({ id: memberGuardian.id, name: memberGuardian.name })
        .from(memberGuardian)
        .where(and(
          eq(memberGuardian.organizationId, organizationId),
          eq(memberGuardian.id, values.guardianId),
          // It must be a guardian OF THIS MEMBER — not just any guardian in the org.
          eq(memberGuardian.memberId, memberId)
        ))
        .limit(1)

      if (!guardian) {
        bad('That guardian does not belong to this member', 'CONSENT_GUARDIAN_INVALID')
      }
      guardianId = guardian!.id
      giverName = guardian!.name
    } else {
      // An adult consents for themselves.
      giverName = member.user.name
    }
  }

  const now = new Date()
  const existing = await db
    .select({ id: memberConsent.id, grantedAt: memberConsent.grantedAt })
    .from(memberConsent)
    .where(and(eq(memberConsent.memberId, memberId), eq(memberConsent.type, type)))
    .limit(1)

  await db
    .insert(memberConsent)
    .values({
      id: randomUUID(),
      organizationId,
      memberId,
      type,
      status: values.status,
      // On withdrawal `grantedAt` is preserved (see below) — it is the evidence of
      // the period during which processing was lawful.
      grantedAt: granted ? now : (existing[0]?.grantedAt ?? null),
      withdrawnAt: granted ? null : now,
      grantedByName: granted ? giverName : (null),
      guardianId: granted ? guardianId : null,
      documentVersion: values.documentVersion,
      notes: values.notes,
      recordedByMemberId
    })
    .onConflictDoUpdate({
      target: [memberConsent.memberId, memberConsent.type],
      set: {
        status: values.status,
        // A withdrawal must NOT clear grantedAt: `sql` keeps the stored value.
        ...(granted ? { grantedAt: now, withdrawnAt: null, grantedByName: giverName, guardianId } : { withdrawnAt: now }),
        documentVersion: values.documentVersion,
        notes: values.notes,
        recordedByMemberId
      }
    })

  const consents = await listMemberConsents(organizationId, memberId)
  const consent = consents?.find(entry => entry.type === type)
  if (!consent) {
    return null
  }

  return { consent, granted, giver: giverName ?? member.user.name }
}

export type { ConsentType }
