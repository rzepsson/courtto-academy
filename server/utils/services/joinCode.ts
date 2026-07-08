import { randomBytes } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../db'
import { orgJoinCode } from '../../database/app-schema'
import { organization } from '../../database/schema'
import type { JoinCode, JoinCodeTarget } from '../../database/types'

// Codes are read aloud and typed by hand, so the alphabet drops the ambiguous
// glyphs (0/O, 1/I). Exactly 32 symbols → one random byte maps to one symbol
// with zero modulo bias (256 = 8 × 32).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

// Each rotation issues a fresh code valid for two weeks — long enough for a
// signup window, short enough that a leaked code self-heals. Organizers can
// rotate manually at any time to invalidate the previous code immediately.
const JOIN_CODE_TTL_MS = 1000 * 60 * 60 * 24 * 14

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return code
}

// Uppercase and drop anything outside the alphabet (spaces, dashes users add
// when reading "ABCD-EFGH") so lookups match regardless of how it was typed.
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const JOIN_CODE_COLUMNS = {
  code: orgJoinCode.code,
  enabled: orgJoinCode.enabled,
  expiresAt: orgJoinCode.expiresAt
}

export async function getOrgJoinCode(organizationId: string): Promise<JoinCode | null> {
  const [row] = await db
    .select(JOIN_CODE_COLUMNS)
    .from(orgJoinCode)
    .where(eq(orgJoinCode.organizationId, organizationId))
    .limit(1)

  return row ?? null
}

// Pause/resume self-enrollment without changing the code. Returns null when the
// school has no code yet (nothing to toggle).
export async function setOrgJoinCodeEnabled(organizationId: string, enabled: boolean): Promise<JoinCode | null> {
  const [row] = await db
    .update(orgJoinCode)
    .set({ enabled })
    .where(eq(orgJoinCode.organizationId, organizationId))
    .returning(JOIN_CODE_COLUMNS)

  return row ?? null
}

// Postgres unique_violation — raised if a freshly generated code collides with
// another org's existing code (the `code` column is globally unique).
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
}

export async function rotateOrgJoinCode(organizationId: string, userId: string): Promise<JoinCode> {
  const expiresAt = new Date(Date.now() + JOIN_CODE_TTL_MS)

  // A collision is astronomically unlikely (32^8 space), but a code clash would
  // otherwise surface as a 500 — so retry with a new code a few times.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode()
    try {
      const [row] = await db
        .insert(orgJoinCode)
        // Rotating always re-enables: issuing a fresh code implies turning
        // self-enrollment back on.
        .values({ organizationId, code, enabled: true, expiresAt, createdBy: userId })
        .onConflictDoUpdate({
          target: orgJoinCode.organizationId,
          set: { code, enabled: true, expiresAt, createdBy: userId }
        })
        .returning(JOIN_CODE_COLUMNS)

      return row!
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 4) {
        continue
      }
      throw error
    }
  }

  throw new Error('Could not generate a unique join code')
}

// Resolves a typed/shared code to its organization, but only while it is still
// valid — expired codes read as not-found so join attempts and previews agree.
export async function resolveJoinCodeTarget(rawCode: string): Promise<JoinCodeTarget | null> {
  const code = normalizeJoinCode(rawCode)
  if (code.length !== CODE_LENGTH) {
    return null
  }

  const [row] = await db
    .select({
      organizationId: orgJoinCode.organizationId,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        logo: organization.logo
      }
    })
    .from(orgJoinCode)
    .innerJoin(organization, eq(orgJoinCode.organizationId, organization.id))
    .where(and(
      eq(orgJoinCode.code, code),
      eq(orgJoinCode.enabled, true),
      gt(orgJoinCode.expiresAt, new Date())
    ))
    .limit(1)

  return row ?? null
}
