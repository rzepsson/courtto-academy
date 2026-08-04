import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { paymentAudit } from '../../database/app-schema'
import type { PaymentAuditEntryDto } from '../../database/types'
import { captureError } from '../monitoring'

// The internal money-movement audit trail (see the paymentAudit table). Append-only:
// this service never updates or deletes. Every read is scoped by organizationId.

interface RecordPaymentAuditInput {
  organizationId: string
  actorMemberId: string | null
  actorName: string | null
  action: string
  enrollmentId: string | null
  studentName: string | null
  amountMinor: number | null
  currency: string | null
  stripeRef: string | null
}

// BEST-EFFORT: a failed audit write must never fail the money operation it records
// (Stripe stays the authoritative ledger). A failure is captured, not thrown —
// mirroring recordAudit for governance events.
export async function recordPaymentAudit(input: RecordPaymentAuditInput): Promise<void> {
  try {
    await db.insert(paymentAudit).values({ id: randomUUID(), ...input })
  } catch (error) {
    captureError(error, { scope: 'paymentAudit.record', organizationId: input.organizationId })
  }
}

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

// The most recent money movements for a school. Newest first; id breaks
// same-timestamp ties so the order is stable.
export async function listPaymentAudit(
  organizationId: string,
  options: { limit?: number } = {}
): Promise<PaymentAuditEntryDto[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)

  return db
    .select({
      id: paymentAudit.id,
      action: paymentAudit.action,
      actorName: paymentAudit.actorName,
      studentName: paymentAudit.studentName,
      amountMinor: paymentAudit.amountMinor,
      currency: paymentAudit.currency,
      createdAt: paymentAudit.createdAt
    })
    .from(paymentAudit)
    .where(eq(paymentAudit.organizationId, organizationId))
    .orderBy(desc(paymentAudit.createdAt), desc(paymentAudit.id))
    .limit(limit)
}
