import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { db } from './db'
import * as schema from '../database/schema'
import { getFirstMembershipOrganizationId } from './services/membership'
import { ac, roles } from '../../shared/permissions'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema
  }),
  emailAndPassword: {
    enabled: true
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
      invitationExpiresIn: 60 * 60 * 24 * 7
    })
  ],
  experimental: {
    joins: true
  }
})
