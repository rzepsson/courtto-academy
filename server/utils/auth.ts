import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { db } from './db'
import * as schema from '../database/schema'
import { getFirstMembershipOrganizationId } from './services/membership'
import { notifyOrgSetupIncomplete } from './services/notifications'
import { ac, roles } from '../../shared/permissions'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema
  }),
  emailAndPassword: {
    enabled: true
  },
  session: {
    // Signed, short-lived copy of the session in a cookie so most requests
    // (SSR render + every requireUserSession) skip the DB round trip. Safe here
    // because activeOrganizationId only ever changes through Better Auth's own
    // API (setActive / the create hook), which refreshes this cache via
    // Set-Cookie; and /api/app-context re-reads memberships live, so removal
    // from a school is caught within the DB, not this window.
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5
    }
  },
  databaseHooks: {
    session: {
      create: {
        before: async session => ({
          data: {
            ...session,
            activeOrganizationId: await getFirstMembershipOrganizationId(session.userId)
          }
        })
      }
    }
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: 'owner',
      // Invites are delivered as copyable links (no mail provider yet),
      // so give schools a full week before they expire.
      invitationExpiresIn: 60 * 60 * 24 * 7,
      organizationHooks: {
        // Nudge the new owner to finish the essential school data. Non-dismissible
        // and deduped; resolved automatically once the profile is complete (see
        // the profile PATCH handler). Best-effort — a notification failure must
        // never fail organization creation.
        afterCreateOrganization: async ({ organization: org, user: owner }) => {
          try {
            await notifyOrgSetupIncomplete(owner.id, org.id, org.name)
          } catch (error) {
            // Don't fail org creation over a notification, but do surface it —
            // a silent swallow would hide a broken emit.
            console.error('[notifications] afterCreateOrganization emit failed', error)
          }
        }
      }
    })
  ],
  experimental: {
    joins: true
  }
})
