// Product-neutral occupancy domain — the reservation primitive (court × time)
// shared by BOTH the server (conflict validation) and the client. This is
// facility-CORE: the future Courtto marketplace books the same primitive, so
// nothing here references lessons/coaches/students. It moves to packages/core
// alongside shared/courts.ts, as one file, when the core is extracted.
//
// Keep free of Nuxt/Node imports — it must load in any context.

// Operational state of an occupancy block. Only non-cancelled rows count toward
// the court double-booking constraint (the partial EXCLUDE index on reservation).
export const RESERVATION_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

// Neutral reason a court is occupied. Ordered neutral-first: `blocked` is the
// safe default. `booking` is the seam the future marketplace fills (a public /
// customer reservation); `lesson` is written by the Academy layer for a block
// decorated by a lessonSession. The core has no structural dependency on
// Academy — this is just the shared vocabulary of occupancy reasons.
export const RESERVATION_KINDS = ['blocked', 'maintenance', 'booking', 'lesson'] as const
export type ReservationKind = (typeof RESERVATION_KINDS)[number]

export function isReservationStatus(value: string): value is ReservationStatus {
  return (RESERVATION_STATUSES as readonly string[]).includes(value)
}

export function isReservationKind(value: string): value is ReservationKind {
  return (RESERVATION_KINDS as readonly string[]).includes(value)
}

// A "court block" is a standalone reservation (no Academy lesson attached) that
// takes a court out of service for a time range — the two non-lesson, non-
// marketplace kinds a facility admin creates directly. The court-overlap EXCLUDE
// is kind-agnostic, so a block automatically prevents lessons (and bookings) from
// being scheduled over it. `maintenance` is the default (resurfacing, repairs);
// `blocked` is a generic closure (private event, weather).
export const COURT_BLOCK_KINDS = ['maintenance', 'blocked'] as const
export type CourtBlockKind = (typeof COURT_BLOCK_KINDS)[number]

export function isCourtBlockKind(value: string): value is CourtBlockKind {
  return (COURT_BLOCK_KINDS as readonly string[]).includes(value)
}

// A single block can't span more than this — a guard against a runaway range
// (e.g. a typo'd year) locking a court out for good. Long closures are still
// expressible; this is just an upper sanity bound.
export const COURT_BLOCK_MAX_DAYS = 366

// Half-open overlap [start, end): back-to-back ranges (aEnd === bStart) do NOT
// overlap — matching Postgres `tstzrange(a, b)` '[)' semantics and the EXCLUDE
// constraint, so a service pre-check and the DB guard agree exactly.
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}
