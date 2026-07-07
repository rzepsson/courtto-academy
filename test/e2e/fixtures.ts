import { env } from 'node:process'
import { test as base, expect, request } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Cookie, Page } from '@playwright/test'
import type { OrgRole } from '../../shared/permissions'
import { resetE2eDb } from './support/db'

const BASE_URL = env.BETTER_AUTH_URL ?? 'http://localhost:3000'

export interface SeededUser {
  name: string
  email: string
  password: string
  // Own request context (its cookie jar authenticates this user for further
  // /api/auth/* calls and can be replayed into a browser context).
  api: APIRequestContext
}

export interface SeededOrg {
  id: string
  slug: string
  name: string
}

let emailCounter = 0

function uniqueEmail(prefix: string): string {
  emailCounter += 1
  return `${prefix}.${Date.now()}.${emailCounter}@test.local`
}

export interface Seed {
  createUser(overrides?: Partial<{ name: string, email: string, password: string }>): Promise<SeededUser>
  createOrg(user: SeededUser, input: { name: string, slug: string }): Promise<SeededOrg>
  invite(inviter: SeededUser, input: { email: string, role: OrgRole, organizationId: string }): Promise<{ id: string }>
  acceptInvite(user: SeededUser, invitationId: string): Promise<void>
  // Copies the user's session cookies into a browser context so it starts signed in.
  authenticate(context: BrowserContext, user: SeededUser): Promise<void>
}

// Extends the base Playwright test with a `seed` fixture.
export const test = base.extend<{ seed: Seed }>({
  seed: async ({ playwright }, use) => {
    const contexts: APIRequestContext[] = []

    const newContext = async () => {
      const ctx = await playwright.request.newContext({
        baseURL: BASE_URL,
        // Better Auth's CSRF check requires a matching Origin on org mutations.
        extraHTTPHeaders: { origin: BASE_URL }
      })
      contexts.push(ctx)
      return ctx
    }

    const seed: Seed = {
      async createUser(overrides = {}) {
        const email = overrides.email ?? uniqueEmail('user')
        const password = overrides.password ?? 'password123'
        const name = overrides.name ?? 'Test User'
        const api = await newContext()

        const res = await api.post('/api/auth/sign-up/email', {
          data: { name, email, password }
        })
        expect(res.ok(), `sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy()

        return { name, email, password, api }
      },

      async createOrg(user, input) {
        const res = await user.api.post('/api/auth/organization/create', {
          data: { name: input.name, slug: input.slug }
        })
        expect(res.ok(), `create org failed: ${res.status()} ${await res.text()}`).toBeTruthy()
        const body = await res.json()
        return { id: body.id, slug: input.slug, name: input.name }
      },

      async invite(inviter, input) {
        const res = await inviter.api.post('/api/auth/organization/invite-member', {
          data: { email: input.email, role: input.role, organizationId: input.organizationId }
        })
        expect(res.ok(), `invite failed: ${res.status()} ${await res.text()}`).toBeTruthy()
        const body = await res.json()
        return { id: body.id }
      },

      async acceptInvite(user, invitationId) {
        const res = await user.api.post('/api/auth/organization/accept-invitation', {
          data: { invitationId }
        })
        expect(res.ok(), `accept failed: ${res.status()} ${await res.text()}`).toBeTruthy()
      },

      async authenticate(context, user) {
        const state = await user.api.storageState()
        const cookies = state.cookies as Cookie[]
        await context.addCookies(cookies)
      }
    }

    await use(seed)

    for (const ctx of contexts) {
      await ctx.dispose()
    }
  }
})

// Truncate the e2e database before every test so specs are fully isolated.
test.beforeEach(async () => {
  await resetE2eDb()
})

// Vue sets `__vue_app__` on the mount container once `app.mount` completes, so
// this waits until the SSR markup is hydrated. Interacting before hydration lets
// the browser fire a native form submit (a GET reload) instead of the client
// handler, so always call this after navigating and before clicking.
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.getElementById('__nuxt') as (HTMLElement & { __vue_app__?: unknown }) | null
    return Boolean(el && el.__vue_app__)
  })
}

export { expect, request, BASE_URL }
