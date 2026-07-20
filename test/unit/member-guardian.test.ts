import { describe, expect, it } from 'vitest'
import {
  GUARDIAN_RELATIONSHIPS,
  MINOR_AGE_YEARS,
  calculateAge,
  hasReachableChannel,
  isCalendarDate,
  isGuardianRelationship,
  isMinor,
  needsGuardian
} from '../../shared/member-guardian'
import { guardianCreateSchema, guardianPatchSchema } from '../../shared/member-guardian-schema'

const raw = (code: string) => code
const create = guardianCreateSchema(raw)
const patch = guardianPatchSchema(raw)

// A fixed "today" so the age assertions never drift with the wall clock.
const TODAY = new Date('2026-07-16T12:00:00Z')

describe('isCalendarDate', () => {
  it('accepts a real calendar date', () => {
    expect(isCalendarDate('2010-02-28')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true) // leap year
  })

  it('rejects impossible and malformed dates', () => {
    expect(isCalendarDate('2026-02-31')).toBe(false)
    expect(isCalendarDate('2023-02-29')).toBe(false) // not a leap year
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('16-07-2026')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })
})

describe('calculateAge', () => {
  it('does not count a birthday that has not come round yet this year', () => {
    // THE classic bug: naive year subtraction says 18 for both of these.
    expect(calculateAge('2008-07-15', TODAY)).toBe(18) // birthday passed yesterday
    expect(calculateAge('2008-07-16', TODAY)).toBe(18) // birthday is today
    expect(calculateAge('2008-07-17', TODAY)).toBe(17) // birthday is tomorrow
  })

  it('handles month boundaries', () => {
    expect(calculateAge('2008-08-01', TODAY)).toBe(17) // next month
    expect(calculateAge('2008-06-30', TODAY)).toBe(18) // last month
  })

  it('returns null for a future birth date rather than a negative age', () => {
    expect(calculateAge('2030-01-01', TODAY)).toBeNull()
  })

  it('returns null for an absurd or malformed date', () => {
    expect(calculateAge('1090-01-01', TODAY)).toBeNull() // typo'd year
    expect(calculateAge('not-a-date', TODAY)).toBeNull()
  })
})

describe('isMinor', () => {
  it('is true below the legal age and false on the birthday itself', () => {
    expect(isMinor('2009-01-01', TODAY)).toBe(true) // 17
    expect(isMinor('2008-07-16', TODAY)).toBe(false) // turns 18 today
    expect(isMinor('2008-07-17', TODAY)).toBe(true) // turns 18 tomorrow
  })

  it('treats a missing or unparseable date as “not a minor”, never a false alarm', () => {
    expect(isMinor(null, TODAY)).toBe(false)
    expect(isMinor(undefined, TODAY)).toBe(false)
    expect(isMinor('garbage', TODAY)).toBe(false)
  })

  it('uses the policy constant, not a magic number', () => {
    expect(MINOR_AGE_YEARS).toBe(18)
  })
})

describe('needsGuardian', () => {
  it('flags only a minor with nobody on file', () => {
    expect(needsGuardian('2015-01-01', 0, TODAY)).toBe(true)
    expect(needsGuardian('2015-01-01', 1, TODAY)).toBe(false)
  })

  it('never flags an adult, however many guardians they have', () => {
    expect(needsGuardian('1990-01-01', 0, TODAY)).toBe(false)
  })

  it('never flags a member with no date of birth (unknown ≠ minor)', () => {
    expect(needsGuardian(null, 0, TODAY)).toBe(false)
  })
})

describe('hasReachableChannel', () => {
  it('requires at least one usable channel', () => {
    expect(hasReachableChannel({ phone: '+48 600 100 200', email: null })).toBe(true)
    expect(hasReachableChannel({ phone: null, email: 'a@b.pl' })).toBe(true)
    expect(hasReachableChannel({ phone: null, email: null })).toBe(false)
  })

  it('does not accept a malformed channel as reachable', () => {
    expect(hasReachableChannel({ phone: 'abc', email: 'nope' })).toBe(false)
  })
})

describe('guardian relationships', () => {
  it('guards the known set', () => {
    for (const value of GUARDIAN_RELATIONSHIPS) {
      expect(isGuardianRelationship(value)).toBe(true)
    }
    expect(isGuardianRelationship('landlord')).toBe(false)
  })
})

describe('guardianCreateSchema', () => {
  const valid = {
    name: '  Anna Kowalska  ',
    relationship: 'mother',
    phone: '+48 600 100 200',
    email: '',
    isPrimary: true,
    notes: ''
  }

  it('accepts and normalizes a valid guardian', () => {
    const result = create.parse(valid)
    expect(result).toMatchObject({ name: 'Anna Kowalska', phone: '+48 600 100 200', email: null, notes: null })
  })

  it('rejects a guardian with no way to reach them', () => {
    const result = create.safeParse({ ...valid, phone: '', email: '' })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toBe('unreachable')
  })

  it('rejects a blank name and an unknown relationship', () => {
    expect(create.safeParse({ ...valid, name: '   ' }).success).toBe(false)
    expect(create.safeParse({ ...valid, relationship: 'landlord' }).success).toBe(false)
  })

  it('rejects a malformed email', () => {
    const result = create.safeParse({ ...valid, phone: '', email: 'not-an-email' })
    expect(result.success).toBe(false)
  })
})

describe('guardianPatchSchema', () => {
  it('validates only the keys present — reachability is the service’s call', () => {
    // Clearing the phone is legal HERE; the service re-checks the merged record,
    // because whether it's reachable depends on the stored email.
    expect(patch.safeParse({ phone: '' }).success).toBe(true)
    expect(patch.parse({ name: '  Ola  ' })).toEqual({ name: 'Ola' })
  })

  it('still rejects a bad value on a present key', () => {
    expect(patch.safeParse({ relationship: 'nope' }).success).toBe(false)
  })
})
