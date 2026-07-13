import { describe, expect, it } from 'vitest'
import { COURT_BLOCK_KINDS, isCourtBlockKind } from '../../shared/reservation'
import { courtBlockCreateSchema } from '../../shared/court-block-schema'
import { blockDaySpan } from '../../app/utils/schedule'

// Identity resolver: error messages are the raw codes, so tests assert on them.
const raw = (code: string) => code
const schema = courtBlockCreateSchema(raw)

const WARSAW = 'Europe/Warsaw'

describe('court block kinds', () => {
  it('recognises only the two block kinds', () => {
    expect(COURT_BLOCK_KINDS).toEqual(['maintenance', 'blocked'])
    expect(isCourtBlockKind('maintenance')).toBe(true)
    expect(isCourtBlockKind('blocked')).toBe(true)
    // A lesson reservation is never a "block" — you can't delete it via the block path.
    expect(isCourtBlockKind('lesson')).toBe(false)
    expect(isCourtBlockKind('booking')).toBe(false)
  })
})

describe('courtBlockCreateSchema', () => {
  const base = { kind: 'maintenance', startLocal: '2026-07-20T00:00', endLocal: '2026-07-21T00:00', title: 'Resurfacing' }

  it('accepts a valid whole-day block', () => {
    const parsed = schema.safeParse(base)
    expect(parsed.success).toBe(true)
  })

  it('defaults an omitted kind (service fills maintenance) and empties a blank title to null', () => {
    const parsed = schema.safeParse({ startLocal: base.startLocal, endLocal: base.endLocal, title: '   ' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.kind).toBeUndefined()
      expect(parsed.data.title).toBeNull()
    }
  })

  it('rejects an invalid kind', () => {
    const parsed = schema.safeParse({ ...base, kind: 'party' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('kind')
  })

  it('rejects a malformed datetime', () => {
    const parsed = schema.safeParse({ ...base, startLocal: '2026-07-20 09:00' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('datetime')
  })

  it('rejects an end at or before the start', () => {
    const equal = schema.safeParse({ ...base, endLocal: base.startLocal })
    expect(equal.success).toBe(false)
    if (!equal.success) expect(equal.error.issues[0]?.message).toBe('range')

    const before = schema.safeParse({ ...base, startLocal: '2026-07-20T12:00', endLocal: '2026-07-20T10:00' })
    expect(before.success).toBe(false)
  })

  it('rejects a block that spans beyond the maximum', () => {
    const parsed = schema.safeParse({ ...base, startLocal: '2026-01-01T00:00', endLocal: '2027-06-01T00:00' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('maxSpan')
  })
})

describe('blockDaySpan', () => {
  it('returns the intraday wall-clock minutes for a same-day block', () => {
    // 07:00Z in summer Warsaw (+2) = 09:00 local; 10:00Z = 12:00 local.
    const span = blockDaySpan('2026-07-20T07:00:00.000Z', '2026-07-20T10:00:00.000Z', '2026-07-20', WARSAW)
    expect(span).toEqual({ startMin: 9 * 60, endMin: 12 * 60 })
  })

  it('clamps a multi-day block to each day (full day = 0..1440)', () => {
    // Whole-day closure: local [2026-07-20T00:00, 2026-07-22T00:00).
    const start = '2026-07-19T22:00:00.000Z' // 00:00 local Jul 20
    const end = '2026-07-21T22:00:00.000Z' // 00:00 local Jul 22
    expect(blockDaySpan(start, end, '2026-07-20', WARSAW)).toEqual({ startMin: 0, endMin: 1440 })
    expect(blockDaySpan(start, end, '2026-07-21', WARSAW)).toEqual({ startMin: 0, endMin: 1440 })
    // The exclusive end day is not covered.
    expect(blockDaySpan(start, end, '2026-07-22', WARSAW)).toBeNull()
    // Nor the day before it starts.
    expect(blockDaySpan(start, end, '2026-07-19', WARSAW)).toBeNull()
  })

  it('clamps the first/last partial day of a multi-day timed block', () => {
    // Local [Jul 20 14:00, Jul 21 11:00).
    const start = '2026-07-20T12:00:00.000Z' // 14:00 local
    const end = '2026-07-21T09:00:00.000Z' // 11:00 local
    expect(blockDaySpan(start, end, '2026-07-20', WARSAW)).toEqual({ startMin: 14 * 60, endMin: 1440 })
    expect(blockDaySpan(start, end, '2026-07-21', WARSAW)).toEqual({ startMin: 0, endMin: 11 * 60 })
  })
})
