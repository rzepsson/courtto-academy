import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCHEDULE_FILTERS,
  NO_COACH_VALUE,
  isScheduleFilterActive,
  sessionMatchesFilters,
  type ScheduleFilterState,
  type ScheduleSessionView
} from '../../app/utils/schedule'

// Minimal session shape the predicate reads; the rest is irrelevant to filtering.
function session(over: Partial<ScheduleSessionView>): ScheduleSessionView {
  return {
    id: 'x',
    seriesId: 's',
    coachMemberId: null,
    courtId: null,
    sport: 'tennis',
    type: 'group',
    status: 'scheduled',
    ...over
  } as ScheduleSessionView
}

const filters = (over: Partial<ScheduleFilterState>): ScheduleFilterState => ({ ...EMPTY_SCHEDULE_FILTERS, ...over })

describe('isScheduleFilterActive', () => {
  it('is false for the empty filter and true once any constraint is set', () => {
    expect(isScheduleFilterActive(EMPTY_SCHEDULE_FILTERS)).toBe(false)
    expect(isScheduleFilterActive(filters({ coachMemberIds: ['c1'] }))).toBe(true)
    expect(isScheduleFilterActive(filters({ status: 'active' }))).toBe(true)
  })
})

describe('sessionMatchesFilters', () => {
  it('matches everything when no constraint is set', () => {
    expect(sessionMatchesFilters(session({}), EMPTY_SCHEDULE_FILTERS)).toBe(true)
  })

  it('filters by coach, treating unassigned via the no-coach sentinel', () => {
    expect(sessionMatchesFilters(session({ coachMemberId: 'c1' }), filters({ coachMemberIds: ['c1'] }))).toBe(true)
    expect(sessionMatchesFilters(session({ coachMemberId: 'c2' }), filters({ coachMemberIds: ['c1'] }))).toBe(false)
    expect(sessionMatchesFilters(session({ coachMemberId: null }), filters({ coachMemberIds: [NO_COACH_VALUE] }))).toBe(true)
    expect(sessionMatchesFilters(session({ coachMemberId: 'c1' }), filters({ coachMemberIds: [NO_COACH_VALUE] }))).toBe(false)
  })

  it('filters by court, excluding sessions with no court', () => {
    expect(sessionMatchesFilters(session({ courtId: 'a' }), filters({ courtIds: ['a', 'b'] }))).toBe(true)
    expect(sessionMatchesFilters(session({ courtId: 'z' }), filters({ courtIds: ['a', 'b'] }))).toBe(false)
    expect(sessionMatchesFilters(session({ courtId: null }), filters({ courtIds: ['a'] }))).toBe(false)
  })

  it('filters by sport and type', () => {
    expect(sessionMatchesFilters(session({ sport: 'padel' }), filters({ sports: ['padel'] }))).toBe(true)
    expect(sessionMatchesFilters(session({ sport: 'tennis' }), filters({ sports: ['padel'] }))).toBe(false)
    expect(sessionMatchesFilters(session({ type: 'individual' }), filters({ types: ['individual'] }))).toBe(true)
    expect(sessionMatchesFilters(session({ type: 'group' }), filters({ types: ['individual'] }))).toBe(false)
  })

  it('filters by status (active hides cancelled, cancelled hides the rest)', () => {
    expect(sessionMatchesFilters(session({ status: 'cancelled' }), filters({ status: 'active' }))).toBe(false)
    expect(sessionMatchesFilters(session({ status: 'scheduled' }), filters({ status: 'active' }))).toBe(true)
    expect(sessionMatchesFilters(session({ status: 'cancelled' }), filters({ status: 'cancelled' }))).toBe(true)
    expect(sessionMatchesFilters(session({ status: 'rescheduled' }), filters({ status: 'cancelled' }))).toBe(false)
  })

  it('applies every active constraint conjunctively', () => {
    const f = filters({ coachMemberIds: ['c1'], courtIds: ['a'], types: ['group'], status: 'active' })
    expect(sessionMatchesFilters(session({ coachMemberId: 'c1', courtId: 'a', type: 'group', status: 'scheduled' }), f)).toBe(true)
    // One mismatch (court) fails the whole predicate.
    expect(sessionMatchesFilters(session({ coachMemberId: 'c1', courtId: 'b', type: 'group', status: 'scheduled' }), f)).toBe(false)
  })
})
