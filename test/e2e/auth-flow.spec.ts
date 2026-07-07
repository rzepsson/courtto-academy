import { expect, test, waitForHydration } from './fixtures'

// Fills and submits the register form. Inputs are selected by their stable
// autocomplete attributes rather than i18n placeholders.
async function registerViaUi(page: import('@playwright/test').Page, user: { name: string, email: string, password: string }) {
  await page.goto('/register')
  await waitForHydration(page)
  await page.locator('input[autocomplete="name"]').fill(user.name)
  await page.locator('input[type="email"]').fill(user.email)
  await page.locator('input[autocomplete="new-password"]').fill(user.password)
  await page.locator('button[type="submit"]').click()
}

test('signup → create school → lands in the school area', async ({ page }) => {
  const email = `owner.${Date.now()}@test.local`

  await registerViaUi(page, { name: 'Ada Owner', email, password: 'password123' })

  // No membership yet → onboarding.
  await page.waitForURL('**/onboarding')

  await page.locator('input').first().fill('Ace Tennis')
  // The slug auto-fills from the name; submit the create form.
  await page.locator('button[type="submit"]').click()

  await page.waitForURL('**/school')
  // Scope to the sidebar school switcher — the name also appears in the heading.
  await expect(page.getByRole('button', { name: 'Switch school' })).toContainText('Ace Tennis')
})

test('owner is routed to /school from /dashboard', async ({ page, context, seed }) => {
  const owner = await seed.createUser()
  await seed.createOrg(owner, { name: 'Ace', slug: 'ace-owner' })
  await seed.authenticate(context, owner)

  await page.goto('/dashboard')
  await page.waitForURL('**/school')
})

test('coach is routed to /coach from /dashboard', async ({ page, context, seed }) => {
  const owner = await seed.createUser()
  const org = await seed.createOrg(owner, { name: 'Ace', slug: 'ace-coach' })

  const coach = await seed.createUser({ email: `coach.${Date.now()}@test.local` })
  const invitation = await seed.invite(owner, { email: coach.email, role: 'coach', organizationId: org.id })
  await seed.acceptInvite(coach, invitation.id)

  await seed.authenticate(context, coach)
  await page.goto('/dashboard')
  await page.waitForURL('**/coach')
})

test('student is routed to /my from /dashboard', async ({ page, context, seed }) => {
  const owner = await seed.createUser()
  const org = await seed.createOrg(owner, { name: 'Ace', slug: 'ace-student' })

  const student = await seed.createUser({ email: `student.${Date.now()}@test.local` })
  const invitation = await seed.invite(owner, { email: student.email, role: 'student', organizationId: org.id })
  await seed.acceptInvite(student, invitation.id)

  await seed.authenticate(context, student)
  await page.goto('/dashboard')
  await page.waitForURL('**/my')
})
