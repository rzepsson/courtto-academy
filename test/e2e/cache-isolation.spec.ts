import { expect, test, waitForHydration } from './fixtures'
import type { Page } from '@playwright/test'

async function loginViaUi(page: Page, user: { email: string, password: string }) {
  await page.goto('/login')
  await waitForHydration(page)
  await page.locator('input[type="email"]').fill(user.email)
  await page.locator('input[autocomplete="current-password"]').fill(user.password)
  await page.locator('button[type="submit"]').click()
}

// Regression test for a fixed bug: the app:context cache is keyed globally, so
// without clearing it on sign-out the previous user's org/memberships leaked
// into the next session in the same tab. This drives the real UI (no hard
// refresh) — sign in as A, sign out, sign in as B — and asserts B never sees A.
test('signing in as a second user in the same tab never shows the first user\'s school', async ({ page, seed }) => {
  const userA = await seed.createUser({ email: `a.${Date.now()}@test.local` })
  const orgA = await seed.createOrg(userA, { name: 'Alpha Tennis A', slug: 'alpha-a' })

  const userB = await seed.createUser({ email: `b.${Date.now()}@test.local` })
  const orgB = await seed.createOrg(userB, { name: 'Bravo Padel B', slug: 'bravo-b' })

  // The sidebar school switcher reflects the active org; scope assertions to it
  // (the org name also appears in the page heading).
  const switcher = page.getByRole('button', { name: 'Switch school' })

  // Sign in as A → their school.
  await loginViaUi(page, userA)
  await page.waitForURL('**/school')
  await expect(switcher).toContainText(orgA.name)

  // Sign out via the footer user menu.
  await page.locator('button', { hasText: userA.email }).click()
  await page.getByRole('menuitem', { name: /sign out/i }).click()
  await page.waitForURL('**/login')

  // Sign in as B in the SAME tab (client-side nav, no reload).
  await loginViaUi(page, userB)
  await page.waitForURL('**/school')

  await expect(switcher).toContainText(orgB.name)
  // The leaked-cache bug would surface A's school here.
  await expect(switcher).not.toContainText(orgA.name)
  await expect(page.getByText(userB.email).first()).toBeVisible()
  await expect(page.getByText(userA.email)).toHaveCount(0)
})
