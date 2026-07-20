import { AREA_ROLES } from '../../../../../shared/permissions'
import type { MemberStatus } from '../../../../../shared/member-profile'
import type { AuditAction } from '../../../../../shared/audit'

// Which lifecycle transition each target status is audited as.
const STATUS_AUDIT = {
  suspended: 'member.suspended',
  archived: 'member.archived',
  active: 'member.reactivated'
} as const satisfies Record<MemberStatus, AuditAction>

// Update a member's sidecar profile (status / canCoach / notes / tags) — school
// roles only. Thin: validate via the shared schema, scope to the active org,
// delegate to the service (which enforces the owner-status guard), then trail the
// governance-relevant transitions (lifecycle + coaching capability). Notes/tags
// edits are low-signal and intentionally not audited. 404 when the id isn't this
// org's member.
export default defineEventHandler(async (event) => {
  const { session, membership } = await requireActiveMembership(event, AREA_ROLES.school)
  const orgId = membership.organization.id
  const memberId = getRouterParam(event, 'id') as string

  // The detail read doubles as the 404 check, the before-state for the audit diff
  // and the source of the target's name snapshot for the org-wide feed.
  const before = await getMemberDetail(orgId, memberId)
  if (!before) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  const patch = await readValidatedBody(event, normalizeMemberProfilePatch)
  const profile = await upsertMemberProfile(orgId, memberId, patch)
  if (!profile) {
    throw createError({ statusCode: 404, statusMessage: 'Member not found', data: { code: 'MEMBER_NOT_FOUND' } })
  }

  const data = { actorName: session.user.name, targetName: before.user.name }
  if (patch.status !== undefined && patch.status !== before.status) {
    await recordAudit({
      organizationId: orgId,
      action: STATUS_AUDIT[patch.status],
      actorMemberId: membership.id,
      targetMemberId: memberId,
      data
    })
  }
  if (patch.canCoach !== undefined && patch.canCoach !== before.canCoach) {
    await recordAudit({
      organizationId: orgId,
      action: patch.canCoach ? 'member.coach_granted' : 'member.coach_revoked',
      actorMemberId: membership.id,
      targetMemberId: memberId,
      data
    })
  }

  return { profile }
})
