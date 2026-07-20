import type { MemberAcademyDto } from '~~/server/database/types'

// Client-facing Academy analytics: over HTTP the Date columns arrive as ISO
// strings, so the panel binds against this string-dated shape (mirrors
// CourtUtilizationView).
export type MemberAcademyView = Omit<MemberAcademyDto, 'from' | 'to'> & {
  from: string
  to: string
}
