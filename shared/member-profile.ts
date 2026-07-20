// Core (product-neutral) governance & capability metadata a membership carries
// beyond what Better Auth's `member` table models. Stored app-side in the
// `member_profile` sidecar (server/database/app-schema.ts) — exactly as
// `orgProfile` extends `organization`. Constants + pure helpers only; kept free
// of Nuxt/Node imports so it loads in any context (the shared/ rule), and mirrors
// the shape of shared/org-profile.ts (constants) vs org-profile-schema.ts (Zod).

import { isOrgRole, type OrgRole } from './permissions'

// Lifecycle status of a membership — orthogonal to the org role:
//   active    — normal, has access
//   suspended — access revoked, membership + history retained (reversible)
//   archived  — former member / alumnus; kept for history, hidden from active rosters
// This is the member analogue of court.archivedAt, but three-state: a single
// nullable timestamp can't encode "suspended" vs "archived", so it's an explicit
// enum. Enforcement in the auth path (rejecting a suspended member) is a later
// phase; today the value is descriptive metadata the directory filters on.
export const MEMBER_STATUSES = ['active', 'suspended', 'archived'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export const MEMBER_STATUS_DEFAULT: MemberStatus = 'active'

export function isMemberStatus(value: string): value is MemberStatus {
  return (MEMBER_STATUSES as readonly string[]).includes(value)
}

// Coerce a stored/untrusted status to a valid one, defaulting unknown/legacy
// values to `active` so a bad row never crashes the directory (mirrors toOrgRole).
export function toMemberStatus(value: string | null | undefined): MemberStatus {
  return value && isMemberStatus(value) ? value : MEMBER_STATUS_DEFAULT
}

// Whether a member is set up to be assigned as a coach on lessons. A `coach`
// always is; an owner/admin only once explicitly granted the capability (they run
// the school AND teach); a student never. Deliberately orthogonal to the lifecycle
// `status` — callers check that separately, so "not set up to coach" and "access
// paused" stay distinct, actionable errors. The single source of truth for both
// the client pickers and the server-side schedule validation.
export function canMemberCoach(member: { role: OrgRole, canCoach: boolean }): boolean {
  return member.role === 'coach' || member.canCoach
}

// Length caps for the free-form sidecar fields (staff-only note + labels).
export const MEMBER_PROFILE_LIMITS = {
  notes: 2000,
  tag: 32,
  tags: 20
} as const

// Directory listing bounds — the members table is server-paginated: the previous
// unbounded list query doesn't scale past a large school's roster.
export const MEMBER_DIRECTORY_PAGE_SIZE = 25
export const MEMBER_DIRECTORY_MAX_PAGE_SIZE = 100

export const MEMBER_DIRECTORY_SORTS = ['name', 'joined', 'role', 'status'] as const
export type MemberDirectorySort = (typeof MEMBER_DIRECTORY_SORTS)[number]

export const MEMBER_DIRECTORY_SORT_DEFAULT: MemberDirectorySort = 'name'

export function isMemberDirectorySort(value: string): value is MemberDirectorySort {
  return (MEMBER_DIRECTORY_SORTS as readonly string[]).includes(value)
}

// Normalize one free-text label: trim, collapse inner whitespace, cap length.
// Empty after trimming → null (dropped by the caller). Deliberately preserves
// display casing — dedup in normalizeTags is case-insensitive, but 'Beginner'
// stays 'Beginner' rather than being lowercased.
export function normalizeTag(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed === '') {
    return null
  }
  return trimmed.slice(0, MEMBER_PROFILE_LIMITS.tag)
}

// Normalize + dedupe (case-insensitively) a list of labels, preserving order.
// Does NOT cap the count — the schema rejects an over-long list so the user gets
// feedback; this only cleans values for storage.
export function normalizeTags(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const tag = normalizeTag(raw)
    if (!tag) {
      continue
    }
    const key = tag.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(tag)
  }
  return out
}

// The (all-optional) filter/sort/paginate inputs the directory accepts. Defined
// here (not in server/database/types) because it's a pure input shape shared by
// the request parser below (server) and, implicitly, the client query builder —
// so it must stay Nuxt/Node-free. Undefined = unfiltered; the service clamps.
export interface MemberDirectoryQuery {
  search?: string
  roles?: OrgRole[]
  statuses?: MemberStatus[]
  canCoach?: boolean
  sort?: MemberDirectorySort
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

// getQuery() yields string | string[] | undefined per key (repeated params become
// arrays). Normalize any of those to a clean string[].
function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null) {
    return []
  }
  return (Array.isArray(value) ? value : [value]).map(String)
}

function toPositiveInt(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

// Parse + validate an untrusted raw query record (from H3's getQuery) into a typed
// directory query. Lenient by design: unknown roles/statuses/sorts are dropped
// rather than erroring, so a stale bookmarked URL degrades gracefully instead of
// 400-ing. Pure — unit-tested, no Nuxt/Node imports.
export function parseMemberDirectoryQuery(raw: Record<string, unknown>): MemberDirectoryQuery {
  const search = typeof raw.search === 'string' ? raw.search.trim() : ''
  const roles = toStringArray(raw.roles).filter(isOrgRole)
  const statuses = toStringArray(raw.statuses).filter(isMemberStatus)
  const sortRaw = typeof raw.sort === 'string' ? raw.sort : ''
  const canCoach = raw.canCoach === 'true' ? true : raw.canCoach === 'false' ? false : undefined

  return {
    search: search === '' ? undefined : search,
    roles: roles.length ? roles : undefined,
    statuses: statuses.length ? statuses : undefined,
    canCoach,
    sort: isMemberDirectorySort(sortRaw) ? sortRaw : undefined,
    order: raw.order === 'desc' ? 'desc' : raw.order === 'asc' ? 'asc' : undefined,
    page: toPositiveInt(raw.page),
    pageSize: toPositiveInt(raw.pageSize)
  }
}
