import { eq } from 'drizzle-orm'
import { db } from '../db'
import { orgProfile } from '../../database/app-schema'
import type { OrgProfileInput } from '../../database/types'
import { orgProfilePatchSchema } from '../../../shared/org-profile-schema'
import { REGIONAL_FALLBACK } from '../../../shared/regional'

// Sensible defaults for the regional fields so a school that never opened
// settings still behaves correctly (notification timing, billing currency).
// Onboarding seeds these from the browser (see shared/regional.ts); this is the
// last-resort fallback (e.g. orgs created via the API). Text/contact fields
// default to null (empty in the UI); only these operational fields get a value.
const PROFILE_DEFAULTS = REGIONAL_FALLBACK

// Returns the profile as a fully-shaped, defaulted object even when no row
// exists yet — the settings form always binds against a complete state.
export async function getOrgProfile(organizationId: string): Promise<OrgProfileInput> {
  const [row] = await db
    .select()
    .from(orgProfile)
    .where(eq(orgProfile.organizationId, organizationId))
    .limit(1)

  return {
    description: row?.description ?? null,
    sports: row?.sports ?? [],
    contactEmail: row?.contactEmail ?? null,
    contactPhone: row?.contactPhone ?? null,
    websiteUrl: row?.websiteUrl ?? null,
    instagramUrl: row?.instagramUrl ?? null,
    facebookUrl: row?.facebookUrl ?? null,
    addressLine1: row?.addressLine1 ?? null,
    addressLine2: row?.addressLine2 ?? null,
    city: row?.city ?? null,
    postalCode: row?.postalCode ?? null,
    country: row?.country ?? PROFILE_DEFAULTS.country,
    timezone: row?.timezone ?? PROFILE_DEFAULTS.timezone,
    locale: row?.locale ?? PROFILE_DEFAULTS.locale,
    currency: row?.currency ?? PROFILE_DEFAULTS.currency,
    legalName: row?.legalName ?? null,
    taxId: row?.taxId ?? null
  }
}

// Built once with the identity message resolver: a validation failure here is
// defense-in-depth behind the form, so the raw error code (never shown to a user)
// is enough — the client already localizes and blocks bad input before submit.
const patchSchema = orgProfilePatchSchema(code => code)

// Validate + normalize an untrusted PATCH body into a partial profile patch,
// against the shared schema that also powers the settings form. Only keys
// actually present in the body survive, so each section updates independently
// without clobbering the others. Throws 400 on bad input. Shaped as a
// `readValidatedBody` validator (takes the raw parsed body).
export function normalizeOrgProfilePatch(body: unknown): Partial<OrgProfileInput> {
  const result = patchSchema.safeParse(body)
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid profile', data: { code: 'INVALID_PROFILE' } })
  }
  return result.data
}

// Insert-or-update the profile for an org. Accepts a partial patch (settings
// saves one section at a time), so only the provided keys are written.
export async function upsertOrgProfile(
  organizationId: string,
  patch: Partial<OrgProfileInput>
): Promise<OrgProfileInput> {
  await db
    .insert(orgProfile)
    .values({ organizationId, ...PROFILE_DEFAULTS, ...patch })
    .onConflictDoUpdate({ target: orgProfile.organizationId, set: patch })

  return getOrgProfile(organizationId)
}
