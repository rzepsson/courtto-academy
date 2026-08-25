import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
// Explicit imports (no Nuxt auto-imports): this module is reachable from
// `server/utils/auth.ts` (the user-created hook), which the `auth` CLI loads
// outside of Nuxt. For the same reason nothing here calls `createError` —
// validation and error shaping stay in the API handlers.
import { db } from '../db'
import { userAgreement, userConsent } from '../../database/app-schema'
import type { AccountConsentDto, UserLegalState } from '../../database/types'
import {
  ACCOUNT_CONSENT_TYPES,
  LEGAL_DOCUMENT_VERSIONS,
  needsReacceptance,
  type AccountConsentType,
  type ConsentDecision,
  type LegalAcceptance
} from '../../../shared/legal'

// Records that a user accepted the documents, at the versions currently in force.
//
// The versions come from the SERVER, never from the client: the browser could
// claim any string, and what matters evidentially is which wording was actually
// being served when the box was ticked. The registration form makes the checkbox
// mandatory, so by the time a user row exists the acceptance has happened — this
// only writes it down.
//
// Append-only: a later re-acceptance inserts another row rather than updating this
// one, so the history of "agreed to which wording, when" survives intact.
export async function recordLegalAcceptance(input: {
  userId: string
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<void> {
  await db.insert(userAgreement).values({
    id: randomUUID(),
    userId: input.userId,
    termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
    privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  })
}

// The user's most recent acceptance, or null if they have never accepted — which
// is the case for every account created before this feature existed. Callers must
// treat null as "must be asked", never as consent by silence.
export async function getLatestAcceptance(userId: string): Promise<LegalAcceptance | null> {
  const [row] = await db
    .select({
      termsVersion: userAgreement.termsVersion,
      privacyVersion: userAgreement.privacyVersion,
      acceptedAt: userAgreement.acceptedAt
    })
    .from(userAgreement)
    .where(eq(userAgreement.userId, userId))
    .orderBy(desc(userAgreement.acceptedAt))
    .limit(1)

  return row ?? null
}

// Every known purpose with the user's current decision on each — absence of a row
// surfaces as `granted: false` with a null timestamp, so "never asked" and
// "withdrawn" stay distinguishable in the UI without the caller reconstructing it.
export async function listAccountConsents(userId: string): Promise<AccountConsentDto[]> {
  const rows = await db
    .select({
      type: userConsent.type,
      status: userConsent.status,
      grantedAt: userConsent.grantedAt,
      withdrawnAt: userConsent.withdrawnAt
    })
    .from(userConsent)
    .where(eq(userConsent.userId, userId))

  const byType = new Map(rows.map(row => [row.type, row]))

  return ACCOUNT_CONSENT_TYPES.map((type) => {
    const row = byType.get(type)
    return {
      type,
      granted: row?.status === 'granted',
      asked: Boolean(row),
      grantedAt: row?.grantedAt ?? null,
      withdrawnAt: row?.withdrawnAt ?? null
    }
  })
}

// Upserts the current decision for one purpose.
//
// Withdrawal deliberately keeps the row AND `grantedAt`: that timestamp is the
// art. 7(1) evidence of the period during which sending was lawful, and erasing it
// would destroy the only proof that the earlier messages were sent legitimately.
// Re-granting moves `grantedAt` forward and clears `withdrawnAt`, because a fresh
// consent starts a fresh lawful period.
export async function setAccountConsent(input: {
  userId: string
  type: AccountConsentType
  decision: ConsentDecision
  documentVersion?: string | null
}): Promise<void> {
  const now = new Date()
  const granting = input.decision === 'granted'

  await db
    .insert(userConsent)
    .values({
      id: randomUUID(),
      userId: input.userId,
      type: input.type,
      status: input.decision,
      grantedAt: granting ? now : null,
      withdrawnAt: granting ? null : now,
      documentVersion: input.documentVersion ?? null
    })
    .onConflictDoUpdate({
      target: [userConsent.userId, userConsent.type],
      set: granting
        ? {
            status: input.decision,
            grantedAt: now,
            withdrawnAt: null,
            documentVersion: input.documentVersion ?? null
          }
        : {
            status: input.decision,
            withdrawnAt: now
          }
    })
}

// One read for the whole legal surface: what they accepted, whether the documents
// have moved on since, and their consent decisions.
export async function getUserLegalState(userId: string): Promise<UserLegalState> {
  const [acceptance, consents] = await Promise.all([
    getLatestAcceptance(userId),
    listAccountConsents(userId)
  ])

  return {
    acceptance,
    needsReacceptance: needsReacceptance(acceptance),
    currentVersions: LEGAL_DOCUMENT_VERSIONS,
    consents
  }
}

// Whether a given purpose may currently be acted on. The only question the rest of
// the app should ask before sending marketing — silence is never permission.
export async function mayContactForMarketing(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: userConsent.status })
    .from(userConsent)
    .where(and(eq(userConsent.userId, userId), eq(userConsent.type, 'marketing')))
    .limit(1)

  return row?.status === 'granted'
}
