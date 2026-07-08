import type { FormError } from '@nuxt/ui'
import { resolveActiveMembership } from '~~/shared/permissions'

export { roleHome } from '~~/shared/permissions'

export function activeMembershipOf<T extends { organization: { id: string } }>(
  context: { memberships: T[], activeOrganizationId: string | null } | null | undefined
): T | null {
  return context ? resolveActiveMembership(context.memberships, context.activeOrganizationId) : null
}

export function sanitizeRedirect(value: unknown, fallback = '/dashboard'): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : fallback
}

// Accepts a full invite URL or a bare invitation id pasted by the user.
export function extractInvitationId(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  const fromUrl = trimmed.match(/\/invite\/([A-Za-z0-9_-]+)/)

  if (fromUrl?.[1]) {
    return fromUrl[1]
  }

  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null
}

// A join code is exactly 8 chars from the server's unambiguous alphabet
// (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no I/O/0/1). This lets us tell a pasted
// code apart from an invitation id, which is a longer random token.
const JOIN_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

// One smart field for the whole "I was given something to join" flow: resolves
// a join code, a join link, or an invite link/id to the page that handles it,
// so users never have to know which kind of thing they're holding. Returns the
// route to navigate to, or null if the input matches nothing.
export function resolveJoinTarget(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  // Full URLs (or path fragments) — route by the path segment.
  const joinUrl = trimmed.match(/\/join\/([A-Za-z0-9-]+)/i)
  if (joinUrl?.[1]) {
    return `/join/${joinUrl[1]}`
  }

  const inviteUrl = trimmed.match(/\/invite\/([A-Za-z0-9_-]+)/)
  if (inviteUrl?.[1]) {
    return `/invite/${inviteUrl[1]}`
  }

  // Bare join code: strip formatting (dashes/spaces), uppercase, shape-check.
  const code = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (JOIN_CODE_RE.test(code)) {
    return `/join/${code}`
  }

  // Otherwise treat a bare token as an invitation id.
  const id = extractInvitationId(trimmed)
  return id ? `/invite/${id}` : null
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Shared client-side validation for the create-school and settings forms so the
// slug rules can't drift between where a school is named and where it's renamed.
export function validateSchoolForm(
  form: { name: string, slug: string },
  t: (key: string) => string
): FormError[] {
  const errors: FormError[] = []

  if (!form.name.trim()) {
    errors.push({ name: 'name', message: t('onboarding.errors.nameRequired') })
  }

  if (!form.slug) {
    errors.push({ name: 'slug', message: t('onboarding.errors.slugRequired') })
  } else if (!SLUG_PATTERN.test(form.slug)) {
    errors.push({ name: 'slug', message: t('onboarding.errors.slugInvalid') })
  }

  return errors
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
