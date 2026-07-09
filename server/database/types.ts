import type { OrgRole } from '../../shared/permissions'

export type Organization = typeof import('./schema').organization.$inferSelect

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  logo: string | null
}

export interface Membership {
  id: string
  role: OrgRole
  createdAt: Date
  organization: OrganizationSummary
}

export interface AppContext {
  memberships: Membership[]
  activeOrganizationId: string | null
}

export interface OrganizationMember {
  id: string
  role: OrgRole
  createdAt: Date
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
}

export interface Invitation {
  id: string
  email: string
  role: OrgRole
  expiresAt: Date
}

export interface JoinCode {
  code: string
  enabled: boolean
  expiresAt: Date
}

export type OrgProfile = typeof import('./app-schema').orgProfile.$inferSelect

// The editable subset of the profile (everything except the org id and the
// managed timestamps). Both the PATCH body and the service `set` are typed
// against this so a new column is wired through in one place.
export type OrgProfileInput = Omit<OrgProfile, 'organizationId' | 'createdAt' | 'updatedAt'>

export type NotificationRow = typeof import('./app-schema').notification.$inferSelect

// The client-facing shape of a notification. `data` is the interpolation params
// for the localized title/body; the server never sends rendered text.
export interface NotificationDto {
  id: string
  type: string
  organizationId: string | null
  data: Record<string, string | number | null> | null
  link: string | null
  read: boolean
  dismissible: boolean
  createdAt: Date
}

export interface NotificationFeed {
  notifications: NotificationDto[]
  unreadCount: number
}

export interface JoinCodeTarget {
  organizationId: string
  organization: OrganizationSummary
}

export type InvitationLandingStatus = 'pending' | 'accepted' | 'rejected' | 'canceled' | 'expired'

export interface InvitationLanding {
  id: string
  maskedEmail: string
  role: OrgRole
  status: InvitationLandingStatus
  expiresAt: Date
  inviterName: string
  organization: OrganizationSummary
}
