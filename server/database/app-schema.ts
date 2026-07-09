import { relations, sql } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
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

// A single court (or table) belonging to a facility. App-owned — facility-core,
// NOT Academy: the future Courtto marketplace books these exact rows, so nothing
// here references lessons/coaches/students. Axes are kept orthogonal (see
// CLAUDE.md): `status` is the day-to-day operational state (active/maintenance)
// while `archivedAt` is the lifecycle (soft-delete) — a court is soft-archived
// rather than hard-deleted so historical schedule/booking references stay valid.
// The white-line PATTERN is derived from `sport` (shared/courts.ts), never
// stored; only the surface/line colours are per-court.
export const court = pgTable(
  'court',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // One of the org's declared sports (shared SPORTS); validated ⊂ orgProfile.sports
    // on write. Drives terminology (court vs table) and the rendered geometry.
    sport: text('sport').notNull(),
    // Surface key valid for `sport` (shared SURFACES_BY_SPORT); null when the
    // discipline has no surface concept (table tennis) or it's unspecified.
    surface: text('surface'),
    environment: text('environment').default('indoor').notNull(),
    status: text('status').default('active').notNull(),
    // Visual customisation for the diagram — surface fill + line colour (#rrggbb).
    surfaceColor: text('surface_color').notNull(),
    lineColor: text('line_color').default('#ffffff').notNull(),
    // Display order within the facility (drag-reorder); assigned max+1 on create.
    sortOrder: integer('sort_order').default(0).notNull(),
    // Lightweight intra-facility grouping ("Hala A") without a separate table; a
    // formal courtZone table is a clean future extension if needed.
    zone: text('zone'),
    // Seam for the future Courtto marketplace — whether this court may be exposed
    // publicly for booking. Unused by Academy today.
    bookable: boolean('bookable').default(false).notNull(),
    notes: text('notes'),
    // Soft-delete: null = active roster, set = archived (retained for history).
    archivedAt: timestamp('archived_at'),
    // Audit; nulled rather than cascade-deleted if the creator leaves the school.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    // Primary access path: a facility's roster in display order.
    index('court_org_sort_idx').on(table.organizationId, table.sortOrder),
    // No two active courts share a (case-insensitive) name within a facility;
    // archived rows are exempt so a name frees up once a court is retired.
    uniqueIndex('court_org_name_uidx')
      .on(table.organizationId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`)
  ]
)

export const courtRelations = relations(court, ({ one }) => ({
  organization: one(organization, {
    fields: [court.organizationId],
    references: [organization.id]
  })
}))

// Per-user notification inbox. Each row is one recipient's own copy, with its
// own read/dismissed state — notifications are never shared across users. The
// row carries a stable machine `type` + JSON `data` (interpolation params),
// never localized text (rule 5); the client renders the copy.
//
// `organizationId` tags the notification with the school it belongs to (null =
// account-level). The bell scopes to the active org + account-level items, so a
// user who owns one school and coaches at another never sees the two contexts
// mixed. Both FKs cascade: deleting a user or an org clears their notifications.
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    // Interpolation params for the localized title/body and any render metadata.
    data: jsonb('data').$type<Record<string, string | number | null>>(),
    // Deep link the bell navigates to on click (null = not clickable).
    link: text('link'),
    // null = unread; set when the user opens the bell (marks the scope read).
    readAt: timestamp('read_at'),
    // System-managed notifications set this false: no `x`, skipped by "clear
    // all", resolved programmatically when their condition clears.
    dismissible: boolean('dismissible').default(true).notNull(),
    // Set on singleton/system notifications so they're created at most once per
    // (user, key) — see the partial unique index below. null for transient ones.
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [
    // Primary access path: a user's inbox, newest first.
    index('notification_user_created_idx').on(table.userId, table.createdAt.desc()),
    // Idempotency for system/singleton notifications, without constraining the
    // transient ones (which leave dedupeKey null).
    uniqueIndex('notification_user_dedupe_uidx')
      .on(table.userId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`)
  ]
)

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, {
    fields: [notification.userId],
    references: [user.id]
  }),
  organization: one(organization, {
    fields: [notification.organizationId],
    references: [organization.id]
  })
}))
