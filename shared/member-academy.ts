// Academy people-analytics domain — pure, no Nuxt/Node imports (the shared/ rule).
// This is the ACADEMY layer: it answers "how much does this person actually do
// here, and in which groups". Kept out of shared/member-profile.ts on purpose —
// that file is product-neutral CORE (governance + capability), this is Academy.

export interface AttendanceTally {
  present: number
  absent: number
  excused: number
  late: number
}

export const EMPTY_ATTENDANCE: AttendanceTally = { present: 0, absent: 0, excused: 0, late: 0 }

// Attendance rate = turned up ÷ was expected to turn up.
//
// `excused` is deliberately excluded from BOTH sides of the ratio: an excused
// absence is a sanctioned one (illness, a cleared conflict), so counting it as a
// miss would make the number punitive and, worse, wrong — a student who excused
// every session would read 0% rather than "nothing to rate". `late` counts as
// turning up, because they did.
//
// null (not 0) when nothing has been marked yet, so the UI shows "—" instead of
// implying a real 0%.
export function attendanceRate(tally: AttendanceTally): number | null {
  const expected = tally.present + tally.late + tally.absent
  if (expected === 0) {
    return null
  }
  return ((tally.present + tally.late) / expected) * 100
}
