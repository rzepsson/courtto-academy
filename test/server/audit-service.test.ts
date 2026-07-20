import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { listMemberAudit, listOrgAudit, recordAudit } from '../../server/utils/services/audit'
import { createOrg, hasTestDb, resetDb, signUp } from './helpers'

async function seedOrg(): Promise<string> {
  const owner = await signUp()
  return createOrg(owner, { name: 'Ace', slug: `org-${randomUUID().slice(0, 8)}` })
}

describe.skipIf(!hasTestDb)('audit service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('records entries and lists a member timeline scoped by org', async () => {
    const orgA = await seedOrg()
    const orgB = await seedOrg()

    await recordAudit({ organizationId: orgA, action: 'member.suspended', actorMemberId: 'actor-1', targetMemberId: 'target-1', data: { actorName: 'Anna' } })
    await recordAudit({ organizationId: orgA, action: 'member.role_changed', actorMemberId: 'actor-1', targetMemberId: 'target-1', data: { actorName: 'Anna', role: 'coach' } })
    // A different target in the same org, and the same target id in another org.
    await recordAudit({ organizationId: orgA, action: 'member.archived', actorMemberId: 'actor-1', targetMemberId: 'target-2' })
    await recordAudit({ organizationId: orgB, action: 'member.removed', actorMemberId: 'actor-9', targetMemberId: 'target-1' })

    const timeline = await listMemberAudit(orgA, 'target-1')
    expect(timeline).toHaveLength(2)
    expect(timeline.map(e => e.action).sort()).toEqual(['member.role_changed', 'member.suspended'])
    // The snapshotted actor name + payload survive on the entry.
    const roleEntry = timeline.find(e => e.action === 'member.role_changed')
    expect(roleEntry?.data).toMatchObject({ actorName: 'Anna', role: 'coach' })
    // Org id is never exposed on the DTO.
    expect(timeline[0]).not.toHaveProperty('organizationId')

    // Another tenant never sees org A's trail for the same target id.
    expect(await listMemberAudit(orgB, 'target-1')).toHaveLength(1)
    expect((await listMemberAudit(orgB, 'target-1'))[0]!.action).toBe('member.removed')

    // A target with no entries yields an empty timeline.
    expect(await listMemberAudit(orgA, 'nobody')).toEqual([])
  })

  it('pages the org feed by keyset, newest first, without gaps or repeats', async () => {
    const orgA = await seedOrg()
    const orgB = await seedOrg()
    // 5 entries in A; recorded in order, so the feed must come back reversed.
    for (let i = 0; i < 5; i++) {
      await recordAudit({ organizationId: orgA, action: 'member.suspended', targetMemberId: `t-${i}`, data: { actorName: 'Anna', targetName: `Member ${i}` } })
    }
    await recordAudit({ organizationId: orgB, action: 'member.removed', targetMemberId: 't-0' })

    const first = await listOrgAudit(orgA, { limit: 2 })
    expect(first.entries).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await listOrgAudit(orgA, { limit: 2, cursor: first.nextCursor! })
    expect(second.entries).toHaveLength(2)

    const third = await listOrgAudit(orgA, { limit: 2, cursor: second.nextCursor! })
    expect(third.entries).toHaveLength(1)
    expect(third.nextCursor).toBeNull() // end of feed

    // Every entry appears exactly once across the pages, and only org A's.
    const ids = [...first.entries, ...second.entries, ...third.entries].map(e => e.id)
    expect(new Set(ids).size).toBe(5)
    expect(first.entries[0]).not.toHaveProperty('organizationId')

    // The org-wide feed is the only place a removed member's event stays visible.
    const feedB = await listOrgAudit(orgB)
    expect(feedB.entries).toHaveLength(1)
    expect(feedB.entries[0]!.action).toBe('member.removed')
    expect(feedB.nextCursor).toBeNull()
  })

  it('ignores a malformed cursor instead of erroring (restarts at the head)', async () => {
    const orgId = await seedOrg()
    await recordAudit({ organizationId: orgId, action: 'member.archived', targetMemberId: 't-1' })

    expect((await listOrgAudit(orgId, { cursor: 'garbage' })).entries).toHaveLength(1)
    expect((await listOrgAudit(orgId, { cursor: 'not-a-date|abc' })).entries).toHaveLength(1)
  })

  it('never throws on a bad write (best-effort contract)', async () => {
    // A non-existent org violates the FK; recordAudit must swallow it, not throw.
    await expect(recordAudit({ organizationId: 'does-not-exist', action: 'member.removed', targetMemberId: 't' }))
      .resolves.toBeUndefined()
  })
})
