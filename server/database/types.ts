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
