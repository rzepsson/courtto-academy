import { describe, expect, it } from 'vitest'
import { SPORTS } from '../../shared/org-profile'
import {
  COURT_SPECS,
  COURT_SURFACES,
  DEFAULT_SURFACE_COLOR,
  SURFACES_BY_SPORT,
  courtUnit,
  isCourtEnvironment,
  isCourtSport,
  isHexColor,
  isValidSurfaceFor
} from '../../shared/courts'
import { courtCreateSchema, courtPatchSchema } from '../../shared/courts-schema'
import { courtZoneSchema } from '../../shared/court-zone-schema'
import { courtMetaParts, courtUnitLabel } from '../../app/utils/courts'

// Identity resolver: error messages are the raw codes, so tests assert on them.
const raw = (code: string) => code

describe('court sport / unit', () => {
  it('accepts known sports and rejects others', () => {
    expect(isCourtSport('tennis')).toBe(true)
    expect(isCourtSport('padel')).toBe(true)
    expect(isCourtSport('golf')).toBe(false)
  })

  it('maps table tennis to a table and racket sports to a court', () => {
    expect(courtUnit('tableTennis')).toBe('table')
    expect(courtUnit('tennis')).toBe('court')
    expect(courtUnit('padel')).toBe('court')
  })

  it('resolves the localized unit-noun key per sport, defaulting to court', () => {
    expect(courtUnitLabel('tableTennis', raw)).toBe('courts.unit.table')
    expect(courtUnitLabel('tennis', raw)).toBe('courts.unit.court')
    expect(courtUnitLabel('beachTennis', raw)).toBe('courts.unit.court')
    // Unrecognized input never throws — it falls back to the court unit.
    expect(courtUnitLabel('golf', raw)).toBe('courts.unit.court')
  })
})

describe('COURT_SPECS', () => {
  it('has a spec for every declared sport', () => {
    for (const sport of SPORTS) {
      expect(COURT_SPECS[sport], `missing spec for ${sport}`).toBeDefined()
    }
  })

  it('has positive dimensions and in-bounds line coordinates', () => {
    for (const sport of SPORTS) {
      const spec = COURT_SPECS[sport]
      expect(spec.width).toBeGreaterThan(0)
      expect(spec.length).toBeGreaterThan(0)
      for (const l of spec.lines) {
        expect(l.x1).toBeGreaterThanOrEqual(0)
        expect(l.y1).toBeGreaterThanOrEqual(0)
        expect(l.x2).toBeLessThanOrEqual(spec.width)
        expect(l.y2).toBeLessThanOrEqual(spec.length)
      }
    }
  })

  it('marks the walled disciplines as enclosed', () => {
    expect(COURT_SPECS.padel.enclosed).toBe(true)
    expect(COURT_SPECS.squash.enclosed).toBe(true)
    expect(COURT_SPECS.racquetball.enclosed).toBe(true)
    expect(COURT_SPECS.tennis.enclosed).toBe(false)
  })

  it('has no net on the wall-play disciplines', () => {
    expect(COURT_SPECS.squash.hasNet).toBe(false)
    expect(COURT_SPECS.racquetball.hasNet).toBe(false)
    expect(COURT_SPECS.tennis.hasNet).toBe(true)
  })
})

describe('surfaces', () => {
  it('lists surfaces for every sport (empty allowed for table tennis)', () => {
    for (const sport of SPORTS) {
      expect(Array.isArray(SURFACES_BY_SPORT[sport])).toBe(true)
    }
    expect(SURFACES_BY_SPORT.tableTennis).toEqual([])
    expect(SURFACES_BY_SPORT.tennis.length).toBeGreaterThan(0)
  })

  it('COURT_SURFACES is the deduped union of all per-sport surfaces', () => {
    for (const surfaces of Object.values(SURFACES_BY_SPORT)) {
      for (const surface of surfaces) {
        expect(COURT_SURFACES).toContain(surface)
      }
    }
    expect(new Set(COURT_SURFACES).size).toBe(COURT_SURFACES.length)
  })

  it('validates a surface only against its own sport', () => {
    expect(isValidSurfaceFor('tennis', 'clay')).toBe(true)
    expect(isValidSurfaceFor('tennis', 'sand')).toBe(false)
    expect(isValidSurfaceFor('beachTennis', 'sand')).toBe(true)
    expect(isValidSurfaceFor('tableTennis', 'hard')).toBe(false)
  })

  it('provides a valid default surface colour for every sport', () => {
    for (const sport of SPORTS) {
      expect(isHexColor(DEFAULT_SURFACE_COLOR[sport]), `bad default for ${sport}`).toBe(true)
    }
  })
})

describe('enums', () => {
  it('validates environments', () => {
    expect(isCourtEnvironment('indoor')).toBe(true)
    expect(isCourtEnvironment('covered')).toBe(true)
    expect(isCourtEnvironment('space')).toBe(false)
  })
})

describe('isHexColor', () => {
  it('accepts #rrggbb only', () => {
    expect(isHexColor('#ffffff')).toBe(true)
    expect(isHexColor('#2F6DB5')).toBe(true)
  })
  it('rejects short, missing-hash, or non-hex values', () => {
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor('2f6db5')).toBe(false)
    expect(isHexColor('#gggggg')).toBe(false)
    expect(isHexColor('red')).toBe(false)
  })
})

describe('courtCreateSchema', () => {
  const schema = courtCreateSchema(raw)

  it('accepts a minimal court; operational defaults are the service’s job, not the schema', () => {
    const result = schema.parse({ name: 'Court 1', sport: 'tennis' })
    expect(result.name).toBe('Court 1')
    expect(result.sport).toBe('tennis')
    // No Zod defaults — so `.partial()` can't resurrect them on a PATCH.
    expect(result.environment).toBeUndefined()
    expect(result.lineColor).toBeUndefined()
  })

  it('trims the name and rejects an empty or missing one', () => {
    expect(schema.safeParse({ sport: 'tennis' }).success).toBe(false)
    expect(schema.safeParse({ name: '   ', sport: 'tennis' }).success).toBe(false)
  })

  it('rejects an unknown sport and a bad colour', () => {
    expect(schema.safeParse({ name: 'C', sport: 'golf' }).success).toBe(false)
    expect(schema.safeParse({ name: 'C', sport: 'tennis', surfaceColor: 'blue' }).success).toBe(false)
  })

  it('validates surface format only, not surface-vs-sport (that is the service’s job)', () => {
    // 'sand' isn't a tennis surface, but the schema accepts any non-empty string;
    // the sport-specific check lives in the service.
    const result = schema.parse({ name: 'C', sport: 'tennis', surface: 'sand' })
    expect(result.surface).toBe('sand')
  })

  it('collapses an empty surface to null', () => {
    expect(schema.parse({ name: 'C', sport: 'tennis', surface: '' }).surface).toBeNull()
  })
})

describe('courtPatchSchema', () => {
  const schema = courtPatchSchema(raw)

  it('validates only the keys present, without injecting defaults', () => {
    const result = schema.parse({ environment: 'covered' })
    expect(result.environment).toBe('covered')
    // A partial patch must NOT resurrect defaults for untouched fields.
    expect(result.lineColor).toBeUndefined()
    expect(result.name).toBeUndefined()
  })

  it('still rejects an invalid value when its key is present', () => {
    expect(schema.safeParse({ environment: 'space' }).success).toBe(false)
    expect(schema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('courtMetaParts', () => {
  it('includes only the parts present, in order (sport · surface · env)', () => {
    expect(courtMetaParts({ sport: 'tennis', surface: 'clay', environment: 'indoor' }, raw)).toEqual([
      'school.settings.sports.tennis',
      'courts.surfaces.clay',
      'courts.environments.indoor'
    ])
  })

  it('drops a missing surface (zone is not an inline part — it is a grouping)', () => {
    expect(courtMetaParts({ sport: 'padel', surface: null, environment: 'outdoor' }, raw)).toEqual([
      'school.settings.sports.padel',
      'courts.environments.outdoor'
    ])
  })
})

describe('courtZoneSchema', () => {
  const schema = courtZoneSchema(raw)

  it('accepts and trims a non-empty name', () => {
    expect(schema.parse({ name: '  Hall A ' }).name).toBe('Hall A')
  })

  it('rejects an empty / whitespace-only name', () => {
    const result = schema.safeParse({ name: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe('nameRequired')
  })

  it('rejects an over-long name', () => {
    const result = schema.safeParse({ name: 'x'.repeat(61) })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe('tooLong')
  })
})
