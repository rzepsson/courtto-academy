import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
// Explicit imports (no Nuxt auto-imports): this file may be pulled into the same
// server graph the `auth` CLI loads. Mirrors membership.ts.
import { db } from '../db'
import { member, user } from '../../database/schema'
import { memberProfile } from '../../database/app-schema'
import type {
  MemberDetail,
  MemberDirectoryResult,
  MemberDirectoryRow,
  MemberProfileInput
} from '../../database/types'
import { toOrgRole } from './membership'
import {
  MEMBER_DIRECTORY_MAX_PAGE_SIZE,
  MEMBER_DIRECTORY_PAGE_SIZE,
  MEMBER_DIRECTORY_SORT_DEFAULT,
  toMemberStatus,
  type MemberDirectoryQuery,
  type MemberDirectorySort
} from '../../../shared/member-profile'
import { memberProfilePatchSchema } from '../../../shared/member-profile-schema'

// The member profile is an app-owned sidecar to Better Auth's `member` (rule 4 is
// scoped to Better-Auth tables), so this service writes it with Drizzle directly.
// Every query is scoped by organizationId — never by memberId alone — so one
// facility can never read or mutate another's members (multi-tenant isolation,
// mirrored by the server tests). Absence of a sidecar row is a valid state: it
// means "the defaults", which the reads coalesce so no backfill is ever needed.

// SQL fragments that fold a missing sidecar row into the column defaults. Used by
// both the SELECT projection and the WHERE filters, so a member with no row is
// treated identically whether we're listing, filtering or sorting.
const statusExpr = sql<string>`coalesce(${memberProfile.status}, 'active')`
const canCoachExpr = sql<boolean>`coalesce(${memberProfile.canCoach}, false)`
const tagsExpr = sql<string[]>`coalesce(${memberProfile.tags}, '{}'::text[])`

// Escape the LIKE wildcards in a user-supplied search term so '%' / '_' / '\'
// are matched literally (Postgres ilike treats them specially otherwise).
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`)
}

// Returns the profile as a fully-shaped, defaulted object even when no sidecar
// row exists yet (mirrors getOrgProfile). Null means the membership doesn't
// belong to this org — the caller returns 404, never leaking another tenant.
export async function getMemberProfile(
  organizationId: string,
  memberId: string
): Promise<MemberProfileInput | null> {
  const [row] = await db
    .select({
      status: memberProfile.status,
      canCoach: memberProfile.canCoach,
      dateOfBirth: memberProfile.dateOfBirth,
      notes: memberProfile.notes,
      tags: memberProfile.tags
    })
    .from(member)
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1)

  if (!row) {
    return null
  }

  return {
    status: toMemberStatus(row.status),
    canCoach: row.canCoach ?? false,
    dateOfBirth: row.dateOfBirth ?? null,
    notes: row.notes ?? null,
    tags: row.tags ?? []
  }
}

// Built once with the identity resolver: a validation failure here is
// defense-in-depth behind the form, so the raw code (never user-facing) is enough.
const patchSchema = memberProfilePatchSchema(code => code)

// Validate + normalize an untrusted PATCH body into a partial profile patch,
// against the shared schema that also powers the staff form. Only keys actually
// present survive, so each control saves independently. Throws 400 on bad input.
// Shaped as a `readValidatedBody` validator (takes the raw parsed body).
export function normalizeMemberProfilePatch(body: unknown): Partial<MemberProfileInput> {
  const result = patchSchema.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid member profile',
      data: { code: 'INVALID_MEMBER_PROFILE' }
    })
  }
  return result.data as Partial<MemberProfileInput>
}

// Insert-or-update the sidecar for one membership. Scoped: the membership must
// belong to `organizationId`, else this is a no-op returning null (never touches
// another tenant, mirroring the courts service). An empty patch reads through
// without writing.
export async function upsertMemberProfile(
  organizationId: string,
  memberId: string,
  patch: Partial<MemberProfileInput>
): Promise<MemberProfileInput | null> {
  const [owned] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1)

  if (!owned) {
    return null
  }

  // Governance guard: the owner can never be suspended or archived — that's the
  // one membership whose loss of access would orphan the school (lockout). Core
  // rule, enforced here rather than in the handler so every writer is covered.
  if (patch.status && patch.status !== 'active' && toOrgRole(owned.role) === 'owner') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Owner status is protected',
      data: { code: 'MEMBER_OWNER_STATUS' }
    })
  }

  if (Object.keys(patch).length > 0) {
    await db
      .insert(memberProfile)
      .values({ memberId, organizationId, ...patch })
      .onConflictDoUpdate({ target: memberProfile.memberId, set: patch })
  }

  return getMemberProfile(organizationId, memberId)
}

// A single member's full record for the detail cockpit (identity + role + sidecar,
// incl. the staff-only notes). Scoped by org — null means the id isn't a member of
// this facility, so the handler 404s without leaking another tenant.
export async function getMemberDetail(
  organizationId: string,
  memberId: string
): Promise<MemberDetail | null> {
  const [row] = await db
    .select({
      id: member.id,
      role: member.role,
      createdAt: member.createdAt,
      status: statusExpr,
      canCoach: canCoachExpr,
      dateOfBirth: memberProfile.dateOfBirth,
      notes: memberProfile.notes,
      tags: tagsExpr,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1)

  if (!row) {
    return null
  }

  return {
    id: row.id,
    role: toOrgRole(row.role),
    createdAt: row.createdAt,
    status: toMemberStatus(row.status),
    canCoach: row.canCoach ?? false,
    dateOfBirth: row.dateOfBirth ?? null,
    notes: row.notes ?? null,
    tags: row.tags ?? [],
    user: {
      id: row.userId,
      name: row.userName,
      email: row.userEmail,
      image: row.userImage
    }
  }
}

// Column projection for a directory row: the Better Auth membership fields joined
// with the coalesced sidecar. Org id / audit columns are never exposed.
const DIRECTORY_COLUMNS = {
  id: member.id,
  role: member.role,
  createdAt: member.createdAt,
  status: statusExpr,
  canCoach: canCoachExpr,
  tags: tagsExpr,
  userId: user.id,
  userName: user.name,
  userEmail: user.email,
  userImage: user.image
}

// Secondary sort is always name asc, so equal roles/statuses list stably.
function directoryOrderBy(sort: MemberDirectorySort, dir: typeof asc) {
  switch (sort) {
    case 'joined':
      return [dir(member.createdAt)]
    case 'role':
      return [dir(member.role), asc(user.name)]
    case 'status':
      return [dir(statusExpr), asc(user.name)]
    default:
      return [dir(user.name)]
  }
}

function clampPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return MEMBER_DIRECTORY_PAGE_SIZE
  }
  return Math.min(Math.max(Math.trunc(value), 1), MEMBER_DIRECTORY_MAX_PAGE_SIZE)
}

// Hard cap on an export so a pathological request can't stream unbounded rows into
// memory. Comfortably above a realistic single-school roster; revisit with true
// streaming if a facility ever legitimately exceeds it.
const EXPORT_MAX_ROWS = 5000

// The scoped WHERE for every directory read (list, count, export) — built once so
// the page, its total and the CSV can never disagree on what matches. Search
// matches name OR email (case-insensitive); status/capability filters resolve
// against the coalesced sidecar so members without a row count as active/non-coach.
function directoryWhere(organizationId: string, query: MemberDirectoryQuery) {
  const conditions = [eq(member.organizationId, organizationId)]

  const search = query.search?.trim()
  if (search) {
    const like = `%${escapeLike(search)}%`
    conditions.push(or(ilike(user.name, like), ilike(user.email, like))!)
  }
  if (query.roles?.length) {
    conditions.push(inArray(member.role, query.roles))
  }
  if (query.statuses?.length) {
    conditions.push(inArray(statusExpr, query.statuses))
  }
  if (query.canCoach !== undefined) {
    conditions.push(eq(canCoachExpr, query.canCoach))
  }

  return and(...conditions)
}

// The shape SELECT(DIRECTORY_COLUMNS) returns, folded into the client-facing row.
type DirectoryRawRow = {
  id: string
  role: string
  createdAt: Date
  status: string
  canCoach: boolean
  tags: string[] | null
  userId: string
  userName: string
  userEmail: string
  userImage: string | null
}

function mapDirectoryRow(row: DirectoryRawRow): MemberDirectoryRow {
  return {
    id: row.id,
    role: toOrgRole(row.role),
    createdAt: row.createdAt,
    status: toMemberStatus(row.status),
    canCoach: row.canCoach ?? false,
    tags: row.tags ?? [],
    user: {
      id: row.userId,
      name: row.userName,
      email: row.userEmail,
      image: row.userImage
    }
  }
}

// The paginated, filterable member directory — the enterprise replacement for the
// old unbounded listOrganizationMembers. Scoped by org; the total reflects the
// same filters so the pagination UI is accurate.
export async function listMembersDirectory(
  organizationId: string,
  query: MemberDirectoryQuery = {}
): Promise<MemberDirectoryResult> {
  const where = directoryWhere(organizationId, query)
  const orderBy = directoryOrderBy(query.sort ?? MEMBER_DIRECTORY_SORT_DEFAULT, query.order === 'desc' ? desc : asc)

  const pageSize = clampPageSize(query.pageSize)
  const page = Math.max(1, Math.trunc(query.page ?? 1))

  const [totalRow] = await db
    .select({ value: count() })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(where)

  const rows = await db
    .select(DIRECTORY_COLUMNS)
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    rows: rows.map(mapDirectoryRow),
    total: totalRow?.value ?? 0,
    page,
    pageSize
  }
}

// The full result set for a CSV export — same filters/sort as the directory, but
// unpaginated (bounded by EXPORT_MAX_ROWS). Scoped by org, so an export can never
// leak another tenant's members.
export async function listMembersForExport(
  organizationId: string,
  query: MemberDirectoryQuery = {}
): Promise<MemberDirectoryRow[]> {
  const where = directoryWhere(organizationId, query)
  const orderBy = directoryOrderBy(query.sort ?? MEMBER_DIRECTORY_SORT_DEFAULT, query.order === 'desc' ? desc : asc)

  const rows = await db
    .select(DIRECTORY_COLUMNS)
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(EXPORT_MAX_ROWS)

  return rows.map(mapDirectoryRow)
}
