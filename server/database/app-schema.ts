import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, index } from 'drizzle-orm/pg-core'
import { organization, user } from './schema'

// App-owned tables live here, NOT in schema.ts — that file is regenerated (and
// fully overwritten) by `pnpm auth:generate`, which only knows about Better
// Auth's tables. Both files are wired into db.ts and drizzle.config.ts.
//
// Unlike the Better Auth tables (rule 4: read-only via services, mutate through
// auth.api.*), this table is ours: services write to it with Drizzle directly.

// One rotatable self-service join code per organization (organizationId is the
// PK, so there is at most one row). Students redeem it to join as `student`;
// privileged roles still go through personal email invitations.
export const orgJoinCode = pgTable(
  'org_join_code',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),
    // Lets a school pause self-enrollment without discarding the code — toggling
    // off blocks redemption (preview + join 404) but keeps the same code so it
    // still works when switched back on.
    enabled: boolean('enabled').default(true).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Kept for audit; nulled rather than cascade-deleted if the creator leaves,
    // so rotating the code never depends on the original author still existing.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' })
  },
  table => [index('org_join_code_code_idx').on(table.code)]
)

export const orgJoinCodeRelations = relations(orgJoinCode, ({ one }) => ({
  organization: one(organization, {
    fields: [orgJoinCode.organizationId],
    references: [organization.id]
  })
}))

// Extended school profile (contact, address, regional & business details) that
// Better Auth's `organization` table doesn't model. One row per org (PK =
// organizationId). Kept out of the auth table on purpose: this is app-domain
// data, we don't want to bloat every get-session/get-full-organization payload,
// and it grows independently of `pnpm auth:generate`. Owner/admin fill it in
// later from school settings — not during onboarding. `name`, `slug` and `logo`
// stay on `organization` (edited via Better Auth); everything else lives here.
export const orgProfile = pgTable('org_profile', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),

  // Public profile / marketing
  description: text('description'),
  // Which racket sports the school offers (e.g. ['tennis', 'padel']); drives
  // terminology across the app. Stored as a Postgres text[].
  sports: text('sports').array(),

  // Contact — public-facing and the reply-to identity for future notifications.
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  websiteUrl: text('website_url'),
  instagramUrl: text('instagram_url'),
  facebookUrl: text('facebook_url'),

  // Location / address
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  postalCode: text('postal_code'),
  country: text('country'), // ISO 3166-1 alpha-2

  // Regional / operational — critical for scheduling & notification timing.
  timezone: text('timezone'), // IANA, e.g. 'Europe/Warsaw'
  locale: text('locale'), // default notification language, 'pl' | 'en'
  currency: text('currency'), // ISO 4217, e.g. 'PLN' — future billing

  // Business / legal — for future invoicing.
  legalName: text('legal_name'),
  taxId: text('tax_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
})

export const orgProfileRelations = relations(orgProfile, ({ one }) => ({
  organization: one(organization, {
    fields: [orgProfile.organizationId],
    references: [organization.id]
  })
}))
