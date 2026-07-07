import { BASE_URL, expect, request, test } from './fixtures'

test('a guest gets 401 from /api/school/members', async () => {
  const anon = await request.newContext({ baseURL: BASE_URL })
  const res = await anon.get('/api/school/members')
  expect(res.status()).toBe(401)
  await anon.dispose()
})

test('a coach gets 403 from /api/school/members', async ({ seed }) => {
  const owner = await seed.createUser()
  const org = await seed.createOrg(owner, { name: 'Ace', slug: 'ace-perm' })

  const coach = await seed.createUser({ email: `coach.${Date.now()}@test.local` })
  const invitation = await seed.invite(owner, { email: coach.email, role: 'coach', organizationId: org.id })
  await seed.acceptInvite(coach, invitation.id)

  // Coach's own authenticated request context hits the school-only endpoint.
  const res = await coach.api.get('/api/school/members')
  expect(res.status()).toBe(403)
})

test('an owner can read /api/school/members', async ({ seed }) => {
  const owner = await seed.createUser()
  await seed.createOrg(owner, { name: 'Ace', slug: 'ace-perm-owner' })

  const res = await owner.api.get('/api/school/members')
  expect(res.ok()).toBeTruthy()
  const members = await res.json()
  expect(Array.isArray(members)).toBe(true)
  expect(members).toHaveLength(1)
})

test('a coach visiting /school is redirected to /coach (no loop)', async ({ page, context, seed }) => {
  const owner = await seed.createUser()
  const org = await seed.createOrg(owner, { name: 'Ace', slug: 'ace-perm-loop' })

  const coach = await seed.createUser({ email: `coach.${Date.now()}@test.local` })
  const invitation = await seed.invite(owner, { email: coach.email, role: 'coach', organizationId: org.id })
  await seed.acceptInvite(coach, invitation.id)

  await seed.authenticate(context, coach)
  await page.goto('/school')
  await page.waitForURL('**/coach')
  // Assert it settled on /coach and did not bounce back.
  expect(new URL(page.url()).pathname).toBe('/coach')
})
