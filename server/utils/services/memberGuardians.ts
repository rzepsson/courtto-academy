import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, ne } from 'drizzle-orm'
import { db } from '../db'
import { memberGuardian } from '../../database/app-schema'
import { member } from '../../database/schema'
import type { MemberGuardianDto, MemberGuardianInput } from '../../database/types'
import { GUARDIAN_LIMITS, hasReachableChannel } from '../../../shared/member-guardian'
import { guardianCreateSchema, guardianPatchSchema } from '../../../shared/member-guardian-schema'

// Guardians of a member — who the school calls. App-owned CORE (it describes a
// person, not a lesson), so this service writes with Drizzle directly. Every query
// is scoped by organizationId — never by id alone — so one school can never read or
// mutate another's contact records (tenant isolation, covered by the server tests).
//
// Invariant: at most ONE primary guardian per member. The DB enforces it (partial
// unique index); this service keeps it *true* — demoting the incumbent inside the
// same transaction — so the index only ever fires on a genuine concurrent write.

const GUARDIAN_COLUMNS = {
  id: memberGuardian.id,
  name: memberGuardian.name,
  relationship: memberGuardian.relationship,
  phone: memberGuardian.phone,
  email: memberGuardian.email,
  isPrimary: memberGuardian.isPrimary,
  notes: memberGuardian.notes,
  createdAt: memberGuardian.createdAt
}

// Built once with the identity resolver: a failure here is defense-in-depth behind
// the form, so the raw code (never user-facing) is enough.
const createSchema = guardianCreateSchema(code => code)
const patchSchema = guardianPatchSchema(code => code)

function bad(message: string, code: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { code } })
}

// The membership must belong to THIS org before we touch its contacts.
async function memberBelongsToOrg(organizationId: string, memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1)
  return row !== undefined
}

// Primary first, then oldest first — the list reads in call order.
export async function listMemberGuardians(
  organizationId: string,
  memberId: string
): Promise<MemberGuardianDto[]> {
  return db
    .select(GUARDIAN_COLUMNS)
    .from(memberGuardian)
    .where(and(
      eq(memberGuardian.organizationId, organizationId),
      eq(memberGuardian.memberId, memberId)
    ))
    .orderBy(desc(memberGuardian.isPrimary), asc(memberGuardian.createdAt))
}

async function getOwned(organizationId: string, guardianId: string) {
  const [row] = await db
    .select()
    .from(memberGuardian)
    .where(and(eq(memberGuardian.organizationId, organizationId), eq(memberGuardian.id, guardianId)))
    .limit(1)
  return row ?? null
}

// Null when the member isn't this org's — the handler 404s rather than leaking.
export async function createMemberGuardian(
  organizationId: string,
  memberId: string,
  body: unknown
): Promise<MemberGuardianDto | null> {
  if (!(await memberBelongsToOrg(organizationId, memberId))) {
    return null
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    bad('Invalid guardian', 'INVALID_GUARDIAN')
  }
  const values = parsed.data

  const existing = await listMemberGuardians(organizationId, memberId)
  if (existing.length >= GUARDIAN_LIMITS.perMember) {
    bad('Too many guardians for this member', 'GUARDIAN_LIMIT_REACHED')
  }

  // The first contact is the primary one by definition — otherwise a school could
  // record a guardian and still have nobody flagged to call first.
  const isPrimary = existing.length === 0 ? true : values.isPrimary

  const [created] = await db.transaction(async (tx) => {
    if (isPrimary) {
      await tx
        .update(memberGuardian)
        .set({ isPrimary: false })
        .where(and(
          eq(memberGuardian.organizationId, organizationId),
          eq(memberGuardian.memberId, memberId),
          eq(memberGuardian.isPrimary, true)
        ))
    }
    return tx
      .insert(memberGuardian)
      .values({
        id: randomUUID(),
        organizationId,
        memberId,
        name: values.name,
        relationship: values.relationship,
        phone: values.phone,
        email: values.email,
        isPrimary,
        notes: values.notes
      })
      .returning(GUARDIAN_COLUMNS)
  })

  return created!
}

export async function updateMemberGuardian(
  organizationId: string,
  guardianId: string,
  body: unknown
): Promise<MemberGuardianDto | null> {
  const stored = await getOwned(organizationId, guardianId)
  if (!stored) {
    return null
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    bad('Invalid guardian', 'INVALID_GUARDIAN')
  }
  const values = parsed.data

  // Reachability is context-dependent on a partial update: clearing `phone` is fine
  // when `email` is already on file, so check the MERGED record, not the patch.
  const merged = {
    phone: values.phone !== undefined ? values.phone : stored.phone,
    email: values.email !== undefined ? values.email : stored.email
  }
  if (!hasReachableChannel(merged)) {
    bad('A guardian needs a phone or an email', 'GUARDIAN_UNREACHABLE')
  }

  const set: Partial<typeof memberGuardian.$inferInsert> = {}
  if (values.name !== undefined) set.name = values.name
  if (values.relationship !== undefined) set.relationship = values.relationship
  if (values.phone !== undefined) set.phone = values.phone
  if (values.email !== undefined) set.email = values.email
  if (values.notes !== undefined) set.notes = values.notes
  if (values.isPrimary !== undefined) set.isPrimary = values.isPrimary

  // Demoting the only primary would leave nobody to call first — that's a no-op,
  // not a state we let the school reach by accident.
  if (values.isPrimary === false && stored.isPrimary) {
    bad('Promote another guardian instead of unsetting the primary', 'GUARDIAN_PRIMARY_REQUIRED')
  }

  const [updated] = await db.transaction(async (tx) => {
    if (set.isPrimary === true && !stored.isPrimary) {
      await tx
        .update(memberGuardian)
        .set({ isPrimary: false })
        .where(and(
          eq(memberGuardian.organizationId, organizationId),
          eq(memberGuardian.memberId, stored.memberId),
          ne(memberGuardian.id, guardianId)
        ))
    }
    return tx
      .update(memberGuardian)
      .set(set)
      .where(and(eq(memberGuardian.organizationId, organizationId), eq(memberGuardian.id, guardianId)))
      .returning(GUARDIAN_COLUMNS)
  })

  return updated ?? null
}

export async function deleteMemberGuardian(
  organizationId: string,
  guardianId: string
): Promise<MemberGuardianDto | null> {
  const stored = await getOwned(organizationId, guardianId)
  if (!stored) {
    return null
  }

  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(memberGuardian)
      .where(and(eq(memberGuardian.organizationId, organizationId), eq(memberGuardian.id, guardianId)))
      .returning(GUARDIAN_COLUMNS)

    // Removing the primary must not silently leave the member with contacts but
    // nobody flagged to call first: promote the longest-standing survivor.
    if (stored.isPrimary) {
      const [next] = await tx
        .select({ id: memberGuardian.id })
        .from(memberGuardian)
        .where(and(
          eq(memberGuardian.organizationId, organizationId),
          eq(memberGuardian.memberId, stored.memberId)
        ))
        .orderBy(asc(memberGuardian.createdAt))
        .limit(1)

      if (next) {
        await tx
          .update(memberGuardian)
          .set({ isPrimary: true })
          .where(eq(memberGuardian.id, next.id))
      }
    }

    return deleted ?? null
  })
}

export type { MemberGuardianInput }
