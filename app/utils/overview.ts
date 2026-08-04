import { DateTime } from 'luxon'
import type { RequiredProfileField } from '~~/shared/org-profile'

// Client-facing owner-dashboard shapes: over HTTP the Date columns arrive as ISO
// strings, so the page binds against these string-dated views (mirrors
// CourtUtilizationView). Pure display helpers live here too so they're shared.

export interface OverviewSessionView {
  id: string
  startsAt: string
  endsAt: string
  title: string
  sport: string
  color: string
  status: string
  courtName: string | null
  coachName: string | null
  capacityMax: number | null
}

export interface OverviewActivityView {
  id: string
  action: string
  actorMemberId: string | null
  targetMemberId: string | null
  data: Record<string, string | number | null> | null
  createdAt: string
}

export interface SchoolOverviewView {
  timezone: string
  counts: { students: number, coaches: number, staff: number, courts: number }
  week: {
    from: string
    to: string
    operating: { open: number, close: number }
    lessonHours: number
    lessonCount: number
    occupancyPct: number
    heatmap: number[]
    peakBucket: { weekday: number, hour: number, minutes: number } | null
  }
  today: { date: string, sessions: OverviewSessionView[] }
  attention: { profileMissing: RequiredProfileField[], pendingInvitations: number }
  activity: OverviewActivityView[]
}

// "17:00" — a wall-clock time rendered in the school's timezone (the instants are
// stored UTC; the school's day is what the owner reads).
export function formatTimeInZone(iso: string, timezone: string, locale: string): string {
  return DateTime.fromISO(iso).setZone(timezone).toLocaleString(DateTime.TIME_SIMPLE, { locale })
}
