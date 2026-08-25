import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { db } from './db'
import * as schema from '../database/schema'
import { getFirstMembershipOrganizationId, toOrgRole } from './services/membership'
import { notifyOrgSetupIncomplete } from './services/notifications'
import { sendMemberInvitationEmail, sendPasswordResetEmail } from './services/email'
import { findAccountDeletionBlocker, prepareAccountDeletion } from './services/account'
import { recordLegalAcceptance } from './services/legal'
import { captureError } from './monitoring'
import { stripe } from './billing-config'
import { ac, roles } from '../../shared/permissions'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema
  }),
  emailAndPassword: {
    enabled: true,
    // Better Auth keeps the reset endpoint uniform (same 200 whether or not the
    // account exists, with a timing-attack guard) and applies a 3-per-60s rate
    // limit to /request-password-reset in production. It builds the tokenized
    // `url` (its /reset-password/:token callback → redirects to our page); we only
    // localize + deliver. Wrapped best-effort so a mail failure can never turn the
    // uniform response into a 500 that would leak whether the account exists.
    sendResetPassword: async ({ user, url }, request) => {
      try {
        await sendPasswordResetEmail({ to: user.email, recipientName: user.name || null, url, request })
      } catch (error) {
        captureError(error, { scope: 'mail.sendResetPassword' })
      }
    }
  },
  user: {
    changeEmail: {
      enabled: true,
      // Email verification is off by product decision, so `emailVerified` is
      // always false — which is the only branch Better Auth's change-email route
      // can take without a verification mailer: the address is updated directly
      // and the session cookie refreshed. Turning verification on later makes
      // this option inert rather than wrong (the confirm-by-email flow takes
      // over), so it doesn't have to be revisited in the same change.
      //
      // Note the route answers 200 without applying the change when the new
      // address already belongs to another account — enumeration safety, by
      // design. The settings card re-reads the session after saving, so the
      // field snaps back to the current address instead of claiming success.
      updateEmailWithoutVerification: true
    },
    deleteUser: {
      enabled: true,
      // Runs before the cascade. Guard first (a school must never lose its last
      // owner), then stop anything that would outlive the row — see
      // services/account.ts for why the order matters. Throwing here aborts the
      // deletion; APIError carries a stable code the client localizes (rule 5).
      beforeDelete: async (deletedUser) => {
        const blocker = await findAccountDeletionBlocker(deletedUser.id)
        if (blocker) {
          throw APIError.from('BAD_REQUEST', {
            code: blocker.code,
            message: `Cannot delete an account that solely owns ${blocker.organizationName}`
          })
        }

        await prepareAccountDeletion(deletedUser.id, deletedUser.name)
      }
    }
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
    user: {
      create: {
        // Record acceptance of the terms + privacy policy at the versions the
        // server was actually serving. Done here rather than from the client so
        // it cannot be skipped or back-dated: the registration form makes the
        // checkbox mandatory, so a user row existing means the box was ticked.
        //
        // Best-effort — a failed evidence write must never block someone from
        // creating an account (mirrors the setup-notification emit), but it is
        // never silent: an unrecorded acceptance is exactly what we would need in
        // a dispute, so it is captured rather than swallowed.
        after: async (newUser, context) => {
          try {
            await recordLegalAcceptance({
              userId: newUser.id,
              ipAddress: context?.headers?.get('x-forwarded-for') ?? null,
              userAgent: context?.headers?.get('user-agent') ?? null
            })
          } catch (error) {
            captureError(error, { scope: 'legal.recordAcceptance' })
          }
        }
      }
    },
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
      // Invitations get a full week to be accepted — long enough that a school can
      // hand-deliver the copyable link if mail bounces.
      invitationExpiresIn: 60 * 60 * 24 * 7,
      // Additive to the copyable link (which the invite modal still shows and is
      // the fallback when mail bounces): also email the recipient. Best-effort —
      // a mail failure must never fail invitation creation, mirroring the setup
      // notification below.
      sendInvitationEmail: async (data) => {
        try {
          await sendMemberInvitationEmail({
            to: data.email,
            organizationId: data.organization.id,
            schoolName: data.organization.name,
            inviterName: data.inviter.user.name,
            role: toOrgRole(data.role),
            invitationId: data.id,
            expiresAt: data.invitation.expiresAt
          })
        } catch (error) {
          captureError(error, { scope: 'mail.sendInvitationEmail', organizationId: data.organization.id })
        }
      },
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
            captureError(error, { scope: 'notifications.afterCreateOrganization', organizationId: org.id })
          }
        }
      }
    }),
    // SaaS subscription billing (Stripe). Declares the Better Auth `subscription`
    // table + `stripeCustomerId` on user/organization (emitted by auth:generate).
    // Config lives in billing-config.ts so this file stays free of the Stripe SDK.
    stripe
  ],
  experimental: {
    joins: true
  }
})
