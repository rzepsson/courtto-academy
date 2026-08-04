import { and, asc, eq, gt } from 'drizzle-orm'
// Explicit imports (no Nuxt auto-imports): this module is pulled in by
// `server/utils/auth.ts`, which the `auth` CLI loads outside of Nuxt.
import { db } from '../db'
import { invitation, member, organization, user } from '../../database/schema'
import { memberProfile } from '../../database/app-schema'
import type { Invitation, InvitationLanding, InvitationLandingStatus, Membership, OrganizationMember } from '../../database/types'
import { isOrgRole } from '../../../shared/permissions'
import type { OrgRole } from '../../../shared/permissions'
import { toMemberStatus } from '../../../shared/member-profile'

// The `role` column is a free-text string at the DB level and may hold legacy
// values (e.g. Better Auth's default 'member' from before custom roles). Coerce
// anything unknown to the least-privileged role so it never crashes the UI.
export function toOrgRole(value: string | null): OrgRole {
  return value && isOrgRole(value) ? value : 'student'
}

export async function listUserMemberships(userId: string): Promise<Membership[]> {
  const rows = await db
    .select({
      id: member.id,
      role: member.role,
      // Coalesced from the sidecar (absent row = active), so access enforcement
      // and /access-paused routing see a member's lifecycle status.
      status: memberProfile.status,
      createdAt: member.createdAt,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo
      }
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))

  return rows.map(row => ({ ...row, role: toOrgRole(row.role), status: toMemberStatus(row.status) }))
}

export async function getFirstMembershipOrganizationId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1)

  return row?.organizationId ?? null
}

export async function isOrganizationMember(organizationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)

  return row !== undefined
}

// Whether the user is THE owner of the org. Gates who may manage the school's
// subscription (the Stripe plugin's authorizeReference) — billing is owner-only,
// like ownership transfer, so an admin can never move money on the school's behalf.
export async function isOrgOwner(organizationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(
      eq(member.organizationId, organizationId),
      eq(member.userId, userId),
      eq(member.role, 'owner')
    ))
    .limit(1)

  return row !== undefined
}

export async function listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
  const rows = await db
    .select({
      id: member.id,
      role: member.role,
      // Coalesced from the sidecar (absent row = active / non-coach) so the
      // schedule + court pickers can filter to assignable people.
      status: memberProfile.status,
      canCoach: memberProfile.canCoach,
      createdAt: member.createdAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image
      }
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(memberProfile, eq(memberProfile.memberId, member.id))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(member.createdAt))

  return rows.map(row => ({
    ...row,
    role: toOrgRole(row.role),
    status: toMemberStatus(row.status),
    canCoach: row.canCoach ?? false
  }))
}

export async function listPendingInvitations(organizationId: string): Promise<Invitation[]> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt
    })
    .from(invitation)
    // Link-only invites never transition to a stored 'expired' status, so filter
    // by the expiry timestamp here — otherwise stale invites linger as "pending"
    // forever, inflating the pending list and the overview stat tile.
    .where(and(
      eq(invitation.organizationId, organizationId),
      eq(invitation.status, 'pending'),
      gt(invitation.expiresAt, new Date())
    ))
    .orderBy(asc(invitation.createdAt))

  return rows.map(row => ({ ...row, role: toOrgRole(row.role) }))
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const visible = local.slice(0, 1)
  return `${visible}${'*'.repeat(Math.max(local.length - 1, 2))}@${domain}`
}

export async function getInvitationLanding(id: string): Promise<InvitationLanding | null> {
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      inviterName: user.name,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo
      }
    })
    .from(invitation)
    .innerJoin(user, eq(invitation.inviterId, user.id))
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(eq(invitation.id, id))
    .limit(1)

  if (!row) {
    return null
  }

  const expired = row.status === 'pending' && row.expiresAt.getTime() < Date.now()

  return {
    id: row.id,
    maskedEmail: maskEmail(row.email),
    role: toOrgRole(row.role),
    status: expired ? 'expired' : row.status as InvitationLandingStatus,
    expiresAt: row.expiresAt,
    inviterName: row.inviterName,
    organization: row.organization
  }
}
